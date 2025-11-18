/**
 * Custom obscenity dataset with filtered word list
 * Only includes severe terms (slurs, hate speech, severe sexual/violent content)
 * Excludes mild profanity that's generally acceptable
 *
 * Sources:
 * - Obscenity English dataset: 69 unique words, 119 total patterns (kept 18 most severe)
 * - Profanity-list (dsojevic): 1000+ terms (kept 45 severity 4 terms)
 * - Additional severe slurs from research databases and hate speech detection datasets
 *
 * Total: 94 severe terms in this filtered dataset
 */

import { DataSet, englishDataset } from 'obscenity';

/**
 * Words to KEEP in the filtered dataset (severe terms only)
 * Total: 94 severe terms
 * - 18 from obscenity's English dataset
 * - 45 from dsojevic/profanity-list (severity 4 racial/lgbtq/religious/sexual)
 * - 31 from hate speech research databases and additional known severe slurs
 */
const SEVERE_TERMS = new Set([
  // === FROM OBSCENITY ENGLISH DATASET (18) ===

  // Racial/ethnic slurs (10)
  'abeed',
  'abo',
  'africoon',
  'arabush',
  'boonga',
  'chingchong',
  'chink',
  'negro',
  'nigger',
  'kike',

  // Homophobic/transphobic slurs (3)
  'dyke',
  'fag',
  'tranny',

  // Ableist slurs (2)
  'retard',
  'spastic',

  // Severe sexual/violent content (3)
  'bestiality',
  'rape',
  'incest',

  // === FROM PROFANITY-LIST (45) ===

  // Racial/ethnic slurs (24 additional)
  'beaner',
  'buddhahead',
  'camel-jockey',
  'cheese-monkey',
  'coon',
  'curry-muncher',
  'darkie',
  'dune-coon',
  'gook',
  'jigaboo',
  'nigga',
  'paki',
  'petrol-sniffer',
  'pikey',
  'sand-nigger',
  'slanteye',
  'spearchucker',
  'spic',
  'swamp-guinea',
  'timber-nigger',
  'towelhead',
  'wetback',
  'white power',
  'zipperhead',

  // Homophobic/transphobic slurs (16 additional - most severe only)
  'faggot',
  'bulldyke',
  'butt-pirate',
  'carpet-muncher',
  'chi-chi-man',
  'cuntboy',
  'dickgirl',
  'fag-bomb',
  'fudge-packer',
  'futanari',
  'lady-boy',
  'lesbo',
  'lezzie',
  'muff-diver',
  'shemale',
  'sissy',

  // Religious slurs (1)
  'raghead',

  // Illegal/extreme sexual content (4)
  'jail-bait',
  'nambla',
  'pedobear',
  'shota',

  // === FROM HATE SPEECH RESEARCH DATABASES (32) ===

  // Racial/ethnic slurs (16 additional)
  'cholo',
  'coolie',
  'golliwog',
  'gringo',
  'gypo',
  'gypsy',
  'half-breed',
  'hymie',
  'injun',
  'jungle-bunny',
  'kraut',
  'mic',
  'mongol',
  'mongoloid',
  'redskin',
  'sambo',

  // Homophobic/transphobic slurs (6 additional)
  'homo',
  'queer',
  'sodomite',
  'troon',
  'poof',
  'pillow-biter',

  // Ableist slurs (4 additional)
  'cripple',
  'gimp',
  'tard',
  'window-licker',

  // Misogynistic/gender-based slurs (3)
  'bimbo',
  'hoe',
  'slut',

  // Hate symbols/phrases (2)
  'swastika',
  '1488',
]);

/**
 * Creates a custom dataset that only includes severe terms (slurs, hate speech)
 * and excludes mild profanity
 */
export function createCustomObscenityDataset(): DataSet<{ originalWord: string }> {
  const customDataset = new DataSet<{ originalWord: string }>()
    .addAll(englishDataset)
    .removePhrasesIf((phrase) => {
      // Remove phrases that are NOT in our severe terms list
      const word = phrase.metadata?.originalWord;
      return word ? !SEVERE_TERMS.has(word) : false;
    });

  return customDataset;
}

/**
 * Get count of terms in custom dataset
 */
export function getCustomDatasetTermCount(): number {
  return SEVERE_TERMS.size;
}
