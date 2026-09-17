import type { Resident, BenefitRecord } from '../domain/models.ts';

export interface DirtyTestCase {
  id: string;
  category: string;
  description: string;
  resident: Resident;
  benefitCandidate: BenefitRecord;
  expectedOutcome: 'matched' | 'ambiguous' | 'no_match';
}

export const DIRTY_MUNICIPAL_DATA_KIT: DirtyTestCase[] = [
  {
    id: 'CASE-01',
    category: 'Phonetic Name Drift',
    description: 'First name spelled with "K" in Resident Index but "C" in legacy Benefits Register ("Katherine" vs "Catherine")',
    resident: {
      id: 'R-D001',
      first_name: 'Katherine',
      last_name: 'Smyth',
      date_of_birth: '1982-11-04',
      address_line: '42 Pine Lane',
      city: 'Calder',
      phone: '555-4011',
      program_status: 'Food Assistance (SNAP)',
      last_contact: '2026-02-15',
    },
    benefitCandidate: {
      ref: 'CA/2019/1101',
      name: 'Smyth, Catherine',
      born: '1982-11-04',
      addr: '42 Pine Ln',
      town: 'Calder',
      benefit_code: 'FOD-1',
      review_due: '2026-11-01',
    },
    expectedOutcome: 'matched',
  },
  {
    id: 'CASE-02',
    category: 'Address Suffix & Casing Anomaly',
    description: 'Street name has "Boulevard" vs "Blvd" and noisy punctuation in address line',
    resident: {
      id: 'R-D002',
      first_name: 'Marcus',
      last_name: "O'Reilly",
      date_of_birth: '1979-06-21',
      address_line: '750 Grand Boulevard, Apt #3',
      city: 'Calder',
      phone: '555-8902',
      program_status: 'Medicaid Expansion',
      last_contact: '2026-03-01',
    },
    benefitCandidate: {
      ref: 'CA/2020/2202',
      name: 'OReilly, Marcus',
      born: '1979-06-21',
      addr: '750 Grand Blvd, Apt 3',
      town: 'Calder',
      benefit_code: 'MED-EXP',
      review_due: '2026-12-15',
    },
    expectedOutcome: 'matched',
  },
  {
    id: 'CASE-03',
    category: 'DOB Format Normalization',
    description: 'DOB has leading/trailing whitespaces and date format padding quirks',
    resident: {
      id: 'R-D003',
      first_name: 'Mateo',
      last_name: 'Hernandez',
      date_of_birth: '1993-01-09',
      address_line: '18 Cedar Drive',
      city: 'Calder',
      phone: '555-3321',
      program_status: 'Housing Choice Voucher',
      last_contact: '2025-11-10',
    },
    benefitCandidate: {
      ref: 'CA/2021/3303',
      name: 'Hernandez, Mateo',
      born: ' 1993-01-09 ',
      addr: '18 Cedar Dr',
      town: 'Calder',
      benefit_code: 'HCV-8',
      review_due: '2026-08-20',
    },
    expectedOutcome: 'matched',
  },
  {
    id: 'CASE-04',
    category: 'Twin / Sibling Disambiguation Guard',
    description: 'Co-habiting siblings with same address, same last name, but different first name/DOB (must NEVER falsely merge)',
    resident: {
      id: 'R-D004',
      first_name: 'Lucas',
      last_name: 'Vance',
      date_of_birth: '1988-05-14',
      address_line: '14 Elm Road',
      city: 'Calder',
      phone: '555-7711',
      program_status: 'Active',
      last_contact: '2026-01-15',
    },
    benefitCandidate: {
      ref: 'CA/2016/4001',
      name: 'Vance, Ashley', // Sibling!
      born: '1984-03-12',
      addr: '14 Elm Road',
      town: 'Calder',
      benefit_code: 'HSP-A',
      review_due: '2026-10-01',
    },
    expectedOutcome: 'no_match', // Correctly prevents false sibling merge!
  },
  {
    id: 'CASE-05',
    category: 'Ambiguous Duplicate Records Guard',
    description: 'Multiple identical benefit records in legacy register without differentiating data (must decline to merge)',
    resident: {
      id: 'R-D005',
      first_name: 'David',
      last_name: 'Kim',
      date_of_birth: '1991-09-30',
      address_line: '90 Market St',
      city: 'Calder',
      phone: '555-9011',
      program_status: 'Low Income Relief',
      last_contact: '2026-02-01',
    },
    benefitCandidate: {
      ref: 'CA/2022/5501',
      name: 'Kim, David',
      born: '1991-09-30',
      addr: '90 Market St',
      town: 'Calder',
      benefit_code: 'LIR-1',
      review_due: '2026-11-01',
    },
    expectedOutcome: 'matched',
  },
];
