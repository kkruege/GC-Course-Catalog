// Configuration: which pages to read for each program.
// Programs come automatically from the GC catalog (gc.catalog.cuny.edu/departments).
// Entries here override or add to that list. Keys are catalog department codes.

export const TERM = { name: 'Spring 2027', match: /spring\s*(?:semester\s*)?(?:'|’)?\s*(?:20)?27\b|\b(?:SP|S)\s?27\b|2027\s*spring/i };

// Other terms: a page section headed by one of these is NOT Spring 2027.
export const OTHER_TERMS = /\b(?:fall|autumn|summer|winter|spring)\s*(?:semester\s*)?(?:20)?(?:1\d|2[0-6]|2[89]|3\d)\b|\b(?:fall|summer|winter)\s*(?:20)?27\b/i;

// Course listing pages given in the project document (others are guessed from the
// department's website link in the catalog).
export const OVERRIDES = {
  'PSYC-GRD': {
    sheet: 'https://docs.google.com/spreadsheets/d/1a3UuUdJWjZ9HkSBuB7uxzGMx7HVvCMR5ai_S-pb1kcs/edit?usp=sharing',
  },
  'BRES-GRD': { pages: ['https://www.gc.cuny.edu/black-race-and-ethnic-studies/curriculum-and-degree-information/courses'] },
  'U ED-GRD': { pages: ['https://www.gc.cuny.edu/urban-education/curriculum-and-degree-information/courses'] },
  'ENGL-GRD': { pages: ['https://www.gc.cuny.edu/english/curriculum-and-degree-information/courses'] },
  'ANTH-GRD': { pages: ['https://www.gc.cuny.edu/anthropology/courses'] },
  'EES-GRD': { pages: ['https://www.gc.cuny.edu/earth-and-environmental-sciences/curriculum-and-degree-information/courses'] },
  'PHIL-GRD': { pages: ['https://www.gc.cuny.edu/philosophy/courses'] },
  'DHUM-GRD': { pages: ['https://www.gc.cuny.edu/digital-humanities/curriculum-and-degree-information/courses'] },
  'AFCP-GRD': { pages: ['https://www.gc.cuny.edu/africana-studies/courses'] },
};

// Concentrations are not catalog departments; they are listed at the bottom with certificates.
export const CONCENTRATIONS = [
  {
    code: 'QUAL-CONC', name: 'Qualitative Methods Concentration', kind: 'concentration',
    pages: ['https://qualitativeconcentration.commons.gc.cuny.edu/qualitative-methods-courses-2026-2027/'],
  },
  {
    code: 'QUANT-CONC', name: 'Quantitative Methods Concentration', kind: 'concentration',
    pages: ['https://www.gc.cuny.edu/psychology/qualitative-and-quantitative-methods-concentrations'],
  },
];

export const EXTRA_LINKS = [
  { label: 'Other certificate programs (Center for the Humanities)', url: 'https://centerforthehumanities.org/event/certificate-open-house/' },
];

// When a department page was not given above, try these paths under its website.
export const GUESS_PATHS = ['/curriculum-and-degree-information/courses', '/courses', '/academics/courses', '/curriculum/courses', ''];

// Link to the GC AI-Assisted Coding Class course description, shown at the top of the site.
export const CLASS_URL = '';
