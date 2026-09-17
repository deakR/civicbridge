import type { AutoUnifiedResponse, Resident, BenefitRecord } from '../domain/models.ts';
import { GroqClient } from './client.ts';
import { MUNICIPAL_CASEWORKER_SYSTEM_PROMPT, AMBIGUITY_INVESTIGATOR_SYSTEM_PROMPT } from './prompts.ts';

export class MunicipalAIAdvisor {
  readonly client: GroqClient;

  constructor(client?: GroqClient) {
    this.client = client || new GroqClient();
  }

  async generateDossier(unified: AutoUnifiedResponse): Promise<string> {
    const resident = unified.resident;
    if (!resident) {
      return 'No resident record available to evaluate.';
    }

    const benefit = unified.benefits;
    const vuln = unified.vulnerability;
    const matchMeta = unified.identity_match;

    if (this.client.hasApiKey()) {
      try {
        const prompt = `Analyze this resident profile and output an Executive Caseworker Briefing and Draft Outreach Notice:
Resident:
- Name: ${resident.first_name} ${resident.last_name} (ID: ${resident.id})
- DOB: ${resident.date_of_birth}
- Address: ${resident.address_line}, ${resident.city}
- Program: ${resident.program_status} (Last contact: ${resident.last_contact})
- Vulnerability Score: ${vuln?.score ?? 'N/A'}/100 (${vuln?.tier ?? 'unknown'} tier)
- Risk Factors: ${vuln?.factors.join('; ') ?? 'None'}

Matched Benefit Record:
${benefit ? `- Ref: ${benefit.ref}\n- Code: ${benefit.benefit_code}\n- Review Due: ${benefit.review_due}\n- Registered Address: ${benefit.addr}, ${benefit.town}` : '- None (No linked benefit record)'}

Identity Match Rule Used: ${matchMeta.evidence.map((e) => e.rule).join(', ') || 'N/A'}`;

        const reply = await this.client.complete({
          messages: [
            { role: 'system', content: MUNICIPAL_CASEWORKER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: 450,
          temperature: 0.2,
        });

        if (reply.trim()) {
          return reply;
        }
      } catch (err) {
        console.warn('[AI Advisor] Groq call failed, falling back to heuristic briefing:', err);
      }
    }

    // Heuristic Fallback (Token-Free & Offline)
    return this.generateHeuristicDossier(unified);
  }

  async *streamDossier(unified: AutoUnifiedResponse): AsyncGenerator<string, void, unknown> {
    const resident = unified.resident;
    if (!resident) {
      yield 'No resident record available to evaluate.';
      return;
    }

    if (this.client.hasApiKey()) {
      try {
        const benefit = unified.benefits;
        const vuln = unified.vulnerability;
        const matchMeta = unified.identity_match;

        const prompt = `Analyze this resident profile and generate an Executive Caseworker Briefing:
Resident: ${resident.first_name} ${resident.last_name} (${resident.id}) | Program: ${resident.program_status}
Vulnerability: ${vuln?.score ?? 'N/A'}/100 (${vuln?.tier ?? 'low'} tier) | Factors: ${vuln?.factors.join(', ') || 'None'}
Benefits: ${benefit ? `${benefit.benefit_code} (Ref: ${benefit.ref}, Review due: ${benefit.review_due})` : 'Unmatched'}
Address: ${resident.address_line}, ${resident.city}`;

        for await (const chunk of this.client.streamComplete({
          messages: [
            { role: 'system', content: MUNICIPAL_CASEWORKER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: 400,
        })) {
          yield chunk;
        }
        return;
      } catch (err) {
        console.warn('[AI Advisor] Streaming failed, falling back to heuristic:', err);
      }
    }

    const fallback = this.generateHeuristicDossier(unified);
    yield fallback;
  }

  async investigateAmbiguity(
    resident: Resident,
    candidates: BenefitRecord[]
  ): Promise<string> {
    if (this.client.hasApiKey()) {
      try {
        const candidateList = candidates
          .map(
            (c, i) =>
              `Candidate #${i + 1} (${c.ref}): Name: "${c.name}", Born: "${c.born}", Addr: "${c.addr}", Town: "${c.town}", Benefit: "${c.benefit_code}"`
          )
          .join('\n');

        const prompt = `Resident to match:
- Name: ${resident.first_name} ${resident.last_name}
- DOB: ${resident.date_of_birth}
- Address: ${resident.address_line}, ${resident.city}

Tied Candidates:
${candidateList}

Explain the discrepancy and recommend a caseworker verification step.`;

        const reply = await this.client.complete({
          messages: [
            { role: 'system', content: AMBIGUITY_INVESTIGATOR_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: 300,
        });

        if (reply.trim()) {
          return reply;
        }
      } catch (err) {
        console.warn('[AI Advisor] Ambiguity analysis failed, falling back to heuristic:', err);
      }
    }

    // Heuristic Fallback
    return `### Ambiguity Resolution Analysis
Deterministic matching found **${candidates.length} identical candidates** for resident **${resident.first_name} ${resident.last_name}**.
- **Candidate References**: ${candidates.map((c) => `\`${c.ref}\``).join(', ')}
- **Discrepancy Analysis**: The candidates share identical demographic and address features in the legacy Benefits Register. Automatic merger is declined to avoid false merges.
- **Caseworker Action**: Contact the resident directly or verify their municipal housing application history to link the authoritative benefit reference.`;
  }

  private generateHeuristicDossier(unified: AutoUnifiedResponse): string {
    const resident = unified.resident!;
    const benefit = unified.benefits;
    const vuln = unified.vulnerability;
    const gaps = unified.benefit_gaps || [];

    const lines: string[] = [];
    lines.push(`### Executive Caseworker Briefing: ${resident.first_name} ${resident.last_name} (${resident.id})`);
    lines.push('');
    lines.push(`- **Municipal Program**: \`${resident.program_status}\` (Last contact: ${resident.last_contact || 'None'})`);
    lines.push(`- **Dwelling**: ${resident.address_line}, ${resident.city}`);

    if (vuln) {
      lines.push(`- **Social Vulnerability Score**: **${vuln.score}/100** (\`${vuln.tier.toUpperCase()}\` risk)`);
      if (vuln.factors.length > 0) {
        lines.push(`  - *Key Factors*: ${vuln.factors.join('; ')}`);
      }
    }

    if (benefit) {
      lines.push(`- **Active Benefit Claim**: \`${benefit.benefit_code}\` (Ref: \`${benefit.ref}\`)`);
      lines.push(`  - *Review Due Date*: **${benefit.review_due}** ${vuln?.review_urgent ? '⚠️ **(Urgent Renewal Required)**' : '✅'}`);
    } else {
      lines.push('- **Active Benefit Claim**: ⚠️ *None on record in Calder County Benefits Register*');
    }

    if (gaps.length > 0) {
      lines.push('');
      lines.push('#### Identified Coverage Gaps');
      for (const gap of gaps) {
        lines.push(`- **${gap.missing_entitlement}**: ${gap.description}`);
        lines.push(`  - *Recommended Intervention*: ${gap.action_recommended}`);
      }
    }

    lines.push('');
    lines.push('#### Recommended Caseworker Action');
    if (vuln?.review_urgent && benefit) {
      lines.push(`Dispatch an urgent renewal reminder for benefit \`${benefit.benefit_code}\` due on **${benefit.review_due}** to prevent benefit lapse.`);
    } else if (!benefit && resident.program_status.toLowerCase().includes('support')) {
      lines.push(`Initiate benefit intake interview to verify eligibility for state assistance under \`${resident.program_status}\`.`);
    } else {
      lines.push('Resident record is stable. Routine annual contact scheduled.');
    }

    return lines.join('\n');
  }
}
