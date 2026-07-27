/**
 * Curated beginner-friendly definitions for English function words.
 *
 * Function words (articles, pronouns, prepositions, conjunctions, auxiliaries)
 * are a small fixed set that automated dictionaries and WordNet handle badly —
 * they pick rare or technical senses (e.g. "a" = "the letter A"). Beginners
 * already use these words, so they only need one short, plain explanation.
 *
 * The seeder prefers these overrides and marks the resulting page `verified`,
 * so later WordNet / LLM passes never overwrite them.
 */
export type FunctionWordDef = {
  pos: string;
  definition: string;
  example: string;
};

export const functionWordDefs: Record<string, FunctionWordDef> = {
  a: {
    pos: "article",
    definition: "Used before a noun to mean one of something, when it is not a specific one.",
    example: "I need a pen.",
  },
  an: {
    pos: "article",
    definition: 'Used like "a" before a word that starts with a vowel sound.',
    example: "She ate an apple.",
  },
  the: {
    pos: "article",
    definition: "Used before a noun for a specific thing that both people already know about.",
    example: "Please close the door.",
  },
  and: {
    pos: "conjunction",
    definition: "Used to join words or ideas together.",
    example: "I like tea and coffee.",
  },
  or: {
    pos: "conjunction",
    definition: "Used to show a choice between two or more things.",
    example: "Do you want tea or coffee?",
  },
  but: {
    pos: "conjunction",
    definition: "Used to add something different or opposite to what came before.",
    example: "I am tired but happy.",
  },
  be: {
    pos: "verb",
    definition: "Used to say what someone or something is, or what they are like.",
    example: "I am a student. She is kind.",
  },
  have: {
    pos: "verb",
    definition: "To own or hold something; also used to talk about the past.",
    example: "I have a car. We have finished.",
  },
  do: {
    pos: "verb",
    definition: "To perform an action; also used to make questions and negatives.",
    example: "I do my homework. Do you like it?",
  },
  he: {
    pos: "pronoun",
    definition: "Used to talk about a man or boy already mentioned.",
    example: "My brother is tall; he plays sports.",
  },
  she: {
    pos: "pronoun",
    definition: "Used to talk about a woman or girl already mentioned.",
    example: "Ann is kind; she helps me.",
  },
  it: {
    pos: "pronoun",
    definition: "Used to talk about a thing, animal, or idea already mentioned.",
    example: "I like this song; it is fun.",
  },
  they: {
    pos: "pronoun",
    definition: "Used to talk about two or more people or things already mentioned.",
    example: "My friends are here; they are waiting.",
  },
  we: {
    pos: "pronoun",
    definition: "Used to talk about yourself together with other people.",
    example: "We are a team.",
  },
  you: {
    pos: "pronoun",
    definition: "Used to talk to the person or people you are speaking with.",
    example: "You are right.",
  },
  i: {
    pos: "pronoun",
    definition: "Used by a speaker to talk about themselves.",
    example: "I am happy today.",
  },
  to: {
    pos: "preposition",
    definition: "Used to show direction or a goal; also used before a verb.",
    example: "I go to school. I want to eat.",
  },
  of: {
    pos: "preposition",
    definition: "Used to show that something belongs to or is part of another thing.",
    example: "the leg of the table",
  },
  in: {
    pos: "preposition",
    definition: "Used to show that something is inside a place or a period of time.",
    example: "The keys are in the box. In summer.",
  },
  on: {
    pos: "preposition",
    definition: "Touching the top or surface of something; or about a day.",
    example: "The book is on the table. On Monday.",
  },
  at: {
    pos: "preposition",
    definition: "Used to show an exact place or time.",
    example: "at home, at 3 o'clock",
  },
  for: {
    pos: "preposition",
    definition: "Used to show who or what something is meant to help, or a reason.",
    example: "This gift is for you.",
  },
  with: {
    pos: "preposition",
    definition: "Together with someone; or using something.",
    example: "Come with me. Cut it with a knife.",
  },
  from: {
    pos: "preposition",
    definition: "Used to show where something starts or comes from.",
    example: "I come from Japan.",
  },
  by: {
    pos: "preposition",
    definition: "Near something; or showing who does an action.",
    example: "Sit by me. It was written by her.",
  },
  as: {
    pos: "preposition",
    definition: 'Used to compare things, or to mean "because" or "while".',
    example: "He is as tall as you.",
  },
  this: {
    pos: "pronoun",
    definition: "Used to point to a thing that is near or was just mentioned.",
    example: "This is my house.",
  },
  that: {
    pos: "pronoun",
    definition: "Used to point to a thing that is further away or already mentioned.",
    example: "That is his car.",
  },
  not: {
    pos: "adverb",
    definition: "Used to make a word or sentence mean the opposite (negative).",
    example: "I am not ready.",
  },
  his: {
    pos: "pronoun",
    definition: "Belonging to a man or boy already mentioned.",
    example: "This is his bag.",
  },
  her: {
    pos: "pronoun",
    definition: "Belonging to a woman or girl already mentioned.",
    example: "Her book is on the desk.",
  },
  their: {
    pos: "pronoun",
    definition: "Belonging to two or more people already mentioned.",
    example: "The children lost their ball.",
  },
  my: {
    pos: "pronoun",
    definition: "Belonging to the person speaking.",
    example: "My name is Sam.",
  },
  your: {
    pos: "pronoun",
    definition: "Belonging to the person or people you are speaking to.",
    example: "Is this your coat?",
  },
};
