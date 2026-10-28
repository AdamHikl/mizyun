/**
 * Deterministic Coach safety screen (AI-01, L10N-01).
 *
 * Text is folded before matching: compatibility decomposition, combining
 * marks removed (so "samovraždu" and "samovrazdu" match the same pattern),
 * default-ignorable characters dropped, lower-cased, typographic apostrophes
 * and dashes unified, hyphens or underscores between letters turned into
 * spaces and whitespace collapsed. Patterns are therefore written in plain
 * ASCII and wrapped with Unicode-aware letter/number boundaries instead of
 * JavaScript `\b`, which treats accented letters as non-word characters.
 *
 * The app is English-only, but users in Slovakia may write in Slovak or
 * Czech, so every critical category carries English, Slovak and Czech
 * patterns. This is a fixed keyword layer, not a classifier: homoglyphs,
 * spaced-out letters and leetspeak are out of scope. The versioned
 * must-block and must-allow corpus guards both misses and false blocks.
 */

export type SafetyCategory =
  | "emergency"
  | "self_harm"
  | "eating_disorder"
  | "medical"
  | "dangerous_target"
  | "prompt_injection";

export type SafetyDecision =
  | {
      readonly allowed: true;
      /** Short "see a professional" note to append to the Coach answer. */
      readonly advisory?: string;
    }
  | {
      readonly allowed: false;
      readonly category: SafetyCategory;
      readonly response: string;
    };

/** Folds case, diacritics, invisible characters and separators for matching. */
export const normalizeSafetyText = (raw: string): string =>
  raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[\p{Default_Ignorable_Code_Point}᠎]/gu, "")
    .toLowerCase()
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/(?<=\p{L})[-_]+(?=\p{L})/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Builds a case-folded matcher whose ends cannot sit inside a word, using
 * Unicode letter/number classes. Use `\p{L}*` inside `source` for stems.
 */
export const safetyPhrase = (source: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "u");

const L = String.raw`\p{L}*`;
const WORDS = (max: number): string => String.raw`(?:[\p{L}'-]+\s+){0,${max}}`;

const anyMatch = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  jeden: 1,
  jedna: 1,
  jednu: 1,
  dva: 2,
  dve: 2,
  tri: 3,
  styri: 4,
  ctyri: 4,
  pat: 5,
  pet: 5,
  sest: 6,
  sedem: 7,
  sedm: 7,
  osem: 8,
  osm: 8,
  desat: 10,
  deset: 10,
};

// Longest words first so "fourteen" is not read as "four".
const NUMBER = String.raw`\d+(?:[.,]\d+)?|${Object.keys(NUMBER_WORDS)
  .sort((left, right) => right.length - left.length)
  .join("|")}`;

const toNumber = (value: string | undefined): number => {
  if (value === undefined) return 1;
  return NUMBER_WORDS[value] ?? Number(value.replace(",", "."));
};

/** Length of a duration word in hours, or null when it is not one. */
const unitHours = (unit: string): number | null => {
  if (/^(?:hours?|hrs?|h|hodin\p{L}*)$/u.test(unit)) return 1;
  if (/^(?:days?|dni|dny|dnu|den|dna|denn\p{L}*|dnov\p{L}*)$/u.test(unit))
    return 24;
  if (/^(?:weeks?|tyzd\p{L}*|tyd\p{L}*)$/u.test(unit)) return 24 * 7;
  if (/^(?:months?|mesiac\p{L}*|mesic\p{L}*)$/u.test(unit)) return 24 * 30.4;
  return null;
};

// ---------------------------------------------------------------------------
// Emergency
// ---------------------------------------------------------------------------

const BREATHING_DIFFICULTY = [
  safetyPhrase(
    String.raw`(?:can'?t|cannot|can not|unable to|struggling to|hard to|trouble|difficulty|difficult to)\s+(?:breathe|breathing|catch my breath)|(?:can'?t|cannot) i (?:breathe|catch my breath)|short(?:ness)? of breath|gasping for (?:air|breath)|(?:isn'?t|is not|not|stopped|has stopped|wasn'?t|aren'?t)\s+breathing(?!\s+(?:properly|correctly|right|through|enough|during|while|when|deeply|in|out)(?![\p{L}]))`,
  ),
  safetyPhrase(
    String.raw`(?:nemozem|nemuzu|nedokazem|nemozes|nemuzes|tazko|tezko|nevladzem)\s+(?:sa\s+(?:mi\s+)?)?dych${L}|dusim sa|dusim se|nedycha${L}`,
  ),
];

/**
 * A breathing complaint asked as an exercise technique or endurance question
 * is coaching. Any distress marker keeps it an emergency.
 */
const EXERCISE_CONTEXT = safetyPhrase(
  String.raw`squat${L}|brac${L}|deadlift${L}|bench${L}|lift${L}|sets?|reps?|run|runs|running|jog${L}|sprint${L}|swim${L}|cardio|hiit|stairs|hik${L}|altitude|mask|gym|workout${L}|training|exercis${L}|beh${L}|behu|drep${L}|cvicen${L}|trening${L}|plavan${L}|schod${L}`,
);
const TECHNIQUE_QUESTION = safetyPhrase(
  String.raw`improve|endurance|tips?|technique|bracing|brace|nose|nosom|cadence|rhythm|rest longer|mask|altitude|how (?:to|do i|can i) (?:stop|avoid|improve|get better)|zlepsit|technik${L}`,
);
const DURING_EXERCISE = safetyPhrase(
  String.raw`(?:during|while|when|mid|between|on|at|in|pri|pocas|behem|cez)\s+${WORDS(2)}(?:squat${L}|deadlift${L}|bench${L}|lift${L}|sets?|reps?|run|runs|running|jog${L}|sprint${L}|swim${L}|cardio|hiit|stairs|hik${L}|altitude|gym|workout${L}|training|exercis${L}|behu|behani|drep${L}|cviceni${L}|treningu|plavani${L})`,
);
const BREATHING_DISTRESS = safetyPhrase(
  String.raw`now|help|lips|blue|wheez${L}|dizzy|faint${L}|chest|throat|worse|not getting better|can'?t stop|hospital|ambulance|at rest|still|racing|heart|light ?headed|pass out|calm down|panic${L}|scared|minutes|pomoc|teraz|modr${L}|hrud${L}|hrdl${L}|zavrat${L}|toci sa mi hlava|nemocnic${L}|sanitk${L}|srdc${L}`,
);

const PERSON = String.raw`(?:he|she|they|someone|somebody|(?:my|our|a|the)\s+(?:friend|dad|mum|mom|mother|father|wife|husband|son|daughter|partner|brother|sister|boyfriend|girlfriend|kid|child|baby|grandma|grandpa|grandmother|grandfather|roommate|flatmate|teammate|colleague|neighbou?r))`;

const EMERGENCY = [
  safetyPhrase(
    String.raw`chest (?:pain|pains|tightness|pressure)|pain (?:in|across) (?:my |the )?chest|crushing (?:pain|chest)|left arm (?:is )?(?:numb|tingling)|numb(?:ness)? in (?:my )?(?:left )?arm|can'?t feel my (?:left |right )?(?:arm|face|legs?)`,
  ),
  safetyPhrase(
    String.raw`unconscious|${PERSON}\s+(?:is|was|'s|are|went|seems)\s+unresponsive`,
  ),
  safetyPhrase(
    String.raw`overdos(?:ed|ing)|(?:took|taken|had|having) an? overdose|i ${WORDS(2)}overdos${L}`,
  ),
  safetyPhrase(
    String.raw`swallowed\s+all\s+(?:of\s+)?(?:my\s+|the\s+)?(?:pills|tablets|meds)|(?:took|taken|swallowed|downed)\s+(?:like\s+|about\s+|around\s+|maybe\s+|over\s+)?(?:a\s+)?(?:whole\s+)?(?:too many|bunch|handful|bottle|box|pack|packet|[1-9]\d+|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s+(?:of\s+)?(?:my\s+|the\s+|sleeping\s+)?(?!(?:creatine|salt|electrolyte|vitamin|magnesium|fish oil|protein|iron|zinc|caffeine|omega|multivitamin)(?![\p{L}]))${WORDS(1)}(?:pills|tablets|paracetamol|ibuprofen|meds|painkillers|medication)`,
  ),
  safetyPhrase(
    String.raw`severe bleeding|bleeding (?:heavily|badly|a lot)|won'?t stop bleeding|coughing up blood|vomiting blood|medical emergency|throat (?:is )?(?:closing|swelling)|face (?:is )?drooping|call(?:ing)? (?:an )?ambulance|tongue (?:is )?swelling|slurred speech|speech (?:is )?slurred|slurring|one side (?:of my (?:body|face) )?(?:is )?(?:weak|numb)|face (?:is )?numb|is this a stroke|${PERSON}\s+(?:is\s+|'s\s+)?(?:seizing|having a seizure|fitting)(?!\s+up)|(?:swallowed|drank|ate)\s+(?:a\s+|some\s+)?(?:battery|batteries|bleach|poison|detergent|antifreeze)|${PERSON}\s+(?:is\s+|are\s+|'s\s+)?(?:not|isn'?t|aren'?t)\s+responding(?!\s+to\s+(?:my\s+)?(?:texts?|messages?|calls?|emails?|training|treatment|physio|diet|exercise|medication))|${PERSON}\s+(?:won'?t|will not|can'?t|isn'?t)\s+(?:wake|waking)\s+up|(?:can'?t|cannot)\s+wake\s+(?:him|her|them)`,
  ),
  // Slovak and Czech.
  safetyPhrase(
    String.raw`bolest${L} (?:na|v|pri) (?:hrudi|hrudniku|prsou|srdci)|(?:boli|bolia|picha|tlaci|stlaca) (?:ma|me|mne) (?:na|v) (?:hrudi|hrudniku|prsou)|tlak na (?:hrudi|prsou)|(?:hrudi|hrudnik${L}) ${WORDS(1)}bol${L}`,
  ),
  safetyPhrase(
    String.raw`bezvedom${L}|v bezvedomi|strat${L} vedomi${L}|ztrat${L} vedomi|predavkov${L}|skolabova${L}|zkolabova${L}|zachrank${L}|(?:silno|silne|velmi|hodne)\s+krvac${L}|krvac${L} (?:sa )?(?:nezastav${L}|nepresta${L})|opuch${L}\s+(?:mi\s+)?(?:hrdlo|jazyk)|(?:hrdlo|jazyk)\s+${WORDS(1)}opuch${L}`,
  ),
  safetyPhrase(
    String.raw`(?:kamarat${L}|priatel${L}|pritel${L}|manzel${L}|partner${L}|on|ona|dieta|dite|syn|dcera|mama|otec|niekto|nekdo|brat|sestra)\s+nereaguj${L}(?!\s+na\s+(?:moje\s+)?(?:spravy|sms|telefon${L}|hovory|volani${L}|maily|emaily))`,
  ),
  safetyPhrase(
    String.raw`spolyka${L}\s+${WORDS(2)}(?:tablet${L}|prask${L}|liek${L}|lek${L})|(?:vzal${L}|zobral${L}|zjedl${L}|zjedol|snedl${L}|polkl${L}|spolkl${L}|prehltol${L})\s+(?:som\s+|jsem\s+)?(?:si\s+)?(?:(?:vela|cele|celu|hodne|celou|cely|[1-9]\d+)\s+${WORDS(1)}(?:tablet${L}|prask${L}|liek${L}|lek${L})|(?:vsetky|vsetk${L}|vsechny)\s+(?:moje\s+|svoje\s+)?(?:tablet${L}|prask${L}))`,
  ),
];

/** "My chest hurts" is an emergency unless it is muscle soreness after training. */
const CHEST_HURTS = safetyPhrase(
  String.raw`chest (?:hurts|is hurting|feels tight|is tight)`,
);
const CARDIAC_RED_FLAGS = safetyPhrase(
  String.raw`dizzy|sweat${L}|nause${L}|jaw|spread${L}|radiat${L}|worse|at rest|breath${L}|faint${L}|arm|light ?headed|heart|racing|pounding|palpitat${L}`,
);
const CHEST_TRAINING_SORENESS = safetyPhrase(
  String.raw`(?:after|from|since)\s+${WORDS(2)}(?:bench${L}|chest day|push ?ups?|fly${L}|flies|dips|pec${L}|press${L})`,
);

/** Fainting is an emergency unless it is history or a prevention question. */
const FAINTING = safetyPhrase(
  String.raw`passed out|passing out|pass out|fainted|fainting|feel(?:ing)? faint|blacked out|(?:i|he|she|they|someone|my \p{L}+) collapsed|omdl${L}|odpad(?:ol|la|li|lo|nem|nes|neme|am|avam|avat|nul|nula)`,
);
const HISTORY_OR_PREVENTION = safetyPhrase(
  String.raw`once|years? ago|last (?:year|month)|in (?:19|20)\d\d|history|used to|cleared|how (?:do|can|to) (?:i )?(?:avoid|prevent|stop) (?:fainting|passing out|feeling faint|blacking out)|avoid (?:fainting|passing out|blacking out)|prevent${L}|predchadz${L}|zabran${L}|pred rokmi|kedysi`,
);
/** Someone else fainting, or fainting today, is always an emergency. */
const THIRD_PARTY_FAINTING = safetyPhrase(
  String.raw`(?:he|she|they|someone|somebody|friend|my\s+(?!self)\p{L}+)\s+(?:just\s+|has\s+|have\s+)?(?:fainted|passed out|collapsed|blacked out)|(?:kamarat${L}|priatel${L}|pritel${L}|on|ona|niekto|nekdo)\s+(?:odpadol|odpadla|omdlel${L}|skolabova${L})`,
);
const FAINTING_NOW = safetyPhrase(
  String.raw`now|today|just|again|help|cpr|won'?t wake|dizzy|still|twice|light ?headed|on the floor|teraz|dnes|prave|pomoc|znova|zase`,
);

/** Named acute conditions are emergencies only when happening now. */
const ACUTE_CONDITION = safetyPhrase(
  String.raw`heart attack|(?<!(?:swim|swimming|rowing|paddle|tennis|golf|breast|back|free|freestyle|butterfly|side)\s?)stroke(?!\s+(?:rate|technique|count|length|work|drill)${L})|seizure${L}|anaphyla${L}|infarkt${L}|mozgov${L} prihod${L}|mrtvic${L}|epilept${L}|zachvat${L}`,
);
const ACUTE_MARKER = safetyPhrase(
  String.raw`having|i think (?:i'?m|i am|he'?s|she'?s|it'?s)|i think (?:he|she|they|i|my \p{L}+) (?:had|has|is|just)|right now|is having|signs of|symptoms of|happening|now|just (?:had|started)|prave|teraz|asi mam|(?:mam|ma|myslim ze mam)\s+(?:infarkt|zachvat|mrtvic${L}|mozgov${L})|dostal${L}`,
);

const HEAD_INJURY = safetyPhrase(
  String.raw`hit my head|head injury|concussion|udrel${L} (?:som |jsem )?(?:sa |se )?do hlavy`,
);
const HEAD_INJURY_SIGNS = safetyPhrase(
  String.raw`vomit${L}|throw${L} up|dizzy|confus${L}|blurr${L}|zvrac${L}|vracia${L}|zavrat${L}`,
);

const isEmergency = (text: string): boolean => {
  if (anyMatch(text, EMERGENCY)) return true;
  if (
    CHEST_HURTS.test(text) &&
    (!CHEST_TRAINING_SORENESS.test(text) || CARDIAC_RED_FLAGS.test(text))
  )
    return true;
  if (
    FAINTING.test(text) &&
    (THIRD_PARTY_FAINTING.test(text) ||
      FAINTING_NOW.test(text) ||
      !HISTORY_OR_PREVENTION.test(text))
  )
    return true;
  if (ACUTE_CONDITION.test(text) && ACUTE_MARKER.test(text)) return true;
  if (HEAD_INJURY.test(text) && HEAD_INJURY_SIGNS.test(text)) return true;
  return false;
};

/** True when a breathing complaint reads as an exercise technique question. */
const isBreathingTechniqueQuestion = (text: string): boolean =>
  EXERCISE_CONTEXT.test(text) &&
  DURING_EXERCISE.test(text) &&
  TECHNIQUE_QUESTION.test(text) &&
  !BREATHING_DISTRESS.test(text);

// ---------------------------------------------------------------------------
// Self-harm (also used by the provider keyword screens)
// ---------------------------------------------------------------------------

const SELF_HARM = [
  // "suicides" / "suicide sprints" are a common shuttle-run drill.
  safetyPhrase(
    String.raw`suicid${L}(?![\s(]+(?:sprint|drill|shuttle)${L})|self[- ]?harm${L}|unalive${L}|(?:wanna|want to|gonna|going to|will|should i|i'?ll|i might|might)\s+kms|^kms$`,
  ),
  safetyPhrase(
    String.raw`kill(?:ing)? ?(?:my|your) ?self|hang(?:ing)? myself|end(?:ing)? my life|take my (?:own )?life|(?:want|wanted|going) (?:to|2) die|wanna die|wish i (?:was|were) dead|(?:better off|rather be) dead|better off without me|(?:don'?t|do not|no longer) (?:want|wanna) (?:to )?(?:live|be alive|exist|wake up|be here anymore)|no reason to (?:live|go on)|(?:not|never) want to wake up|can'?t go on (?:like this|anymore|any more)|(?:nobody|no one) would (?:miss me|care if i)|nema cenu (?:zit|zyt)|(?:thinking|think|thought) (?:of|about) ending (?:it|things|my life)|better off if i (?:was|were|am) gone|(?:everyone|everybody|they) would be better off|(?:what'?s|what is) the point (?:of|in) (?:living|life|going on)|(?:i'?m|i am|i feel like) (?:just )?a burden|relapsed (?:and|into) (?:cut${L}|self)|rather not wake up|want(?:ed)? to disappear`,
  ),
  safetyPhrase(
    String.raw`(?:(?:to|going to|gonna|will|i'?ll|want to)\s+end (?:things|it)(?: all| tonight| today| now)?|end(?:ing)? it all)(?!\s+(?:(?:with|on|after)\s+(?:a\s+|the\s+|my\s+|some\s+)?(?:\d+\s*(?:-\s*)?minutes?\s+|\p{L}+\s+)?(?:cooldown|cool down|stretch${L}|set|rep|session|workout|run|sprint|plank|walk|swim|lap)|now and|and go|and head|early|for today)(?![\p{L}]))|pills? (?:saved|stockpiled|stashed)`,
  ),
  safetyPhrase(
    String.raw`(?:want|wanna|going|urge|urges|feel like|thinking about|thoughts? (?:of|about)|keep|need) (?:to )?${WORDS(1)}(?:hurt|harm|cut|burn|injure)(?:ing)? myself|cutting myself|cut(?:ting)? my (?:wrists?|arms?|thighs?)|(?:cut|hurt) myself on purpose|jump(?:ing)? off (?:a |the )?(?:bridge|building|roof|cliff)`,
  ),
  // Slovak and Czech.
  safetyPhrase(
    String.raw`samovra(?:zd|zed)${L}|sebevra(?:zd|zed)${L}|sebaposkod${L}|sebeposkoz${L}|(?:zabit|zabijem|zabiju|zabila?)\s+(?:sa|se)|(?:sa|se)\s+zabi${L}`,
  ),
  safetyPhrase(
    String.raw`(?:chcem|chci|chcel${L}|chtel${L}|chut|myslim na to|nutkanie|nutkani)\s+${WORDS(2)}ubliz${L}|ubliz${L}\s+(?:sebe|si)\s+(?:naschval|schvalne|umyselne|zamerne)|ubliz(?:ujem|uju|ovat|ovanie)\s+(?:si|sebe)`,
  ),
  safetyPhrase(
    String.raw`(?:chcem|chci|chcel${L}|chtel${L}|radsej|radeji)\s+(?:by\s+(?:som|si|sme)\s+|bych\s+)?(?:uz\s+)?(?:zomriet|umriet|umrit|zemrit|byt mrtv${L}|bol${L} mrtv${L})|(?:nechcem|nechci)\s+(?:uz\s+|dalej\s+|dal\s+)?(?:zit|zyt|existovat)`,
  ),
  safetyPhrase(
    String.raw`(?:nema|nemam|nevidim)\s+${WORDS(2)}(?:zmysel|smysl)\s+${WORDS(1)}(?:zit|zyt)|nemam (?:pre|pro|preco|zac) (?:co )?(?:zit|zyt)|skonc(?:it|ovat|im|ila|il|ime)${L}\s+(?:so|se)\s+(?:zivotom|zivotem|sebou)|skoc${L}\s+(?:z|zo|pod)\s+(?:mosta|mostu|strechy|okna|vlak${L}|budovy)`,
  ),
  safetyPhrase(
    String.raw`podreza${L}\s+(?:si\s+)?(?:sa|se|zil${L}|zapast${L})|(?:sa|se)\s+podreza${L}|rez(?:em|u|e)\s+(?:sa|se)|porezav${L}\s+(?:sa|se)|(?:sa|se)\s+porezav${L}`,
  ),
];

// ---------------------------------------------------------------------------
// Eating disorders
// ---------------------------------------------------------------------------

const WEIGHT_LOSS_INTENT = safetyPhrase(
  String.raw`lose|losing|slim${L}|thin|thinner|skinny|skinnier|drop|flat stomach|chudn${L}|schudn${L}|hubn${L}|zhub${L}`,
);
const FOOD_WORDS = safetyPhrase(
  String.raw`jedl${L}|jidl${L}|jest|jist|najed${L}|zjed${L}|jedenie|jedeni|chudn${L}|schudn${L}|hubn${L}|zhub${L}|vah${L}`,
);

const EATING_DISORDER = [
  safetyPhrase(
    String.raw`purg(?:e|es|ed|ing)(?!\s+(?:the\s+|my\s+)?(?:cache|data|app|history|logs?|files?))|anorexi${L}|bulimi${L}|pro[- ]?ana|pro[- ]?mia|thinspo${L}|meanspo|chew and spit${L}`,
  ),
  safetyPhrase(
    String.raw`(?:make|made|making|force|forced|forcing)\s+(?:myself|me)\s+(?:throw up|vomit|puke|be sick|sick)|self[- ]induced vomit${L}|fingers? down my throat|prst${L} do krku`,
  ),
  safetyPhrase(
    String.raw`(?:throw|throwing|threw|vomit${L}|puk(?:e|ing|ed))\s+(?:up\s+)?(?:after (?:eating|i eat|i ate|(?:every |each )?meals?|food|dinner|lunch|breakfast|binge${L})|(?:what|everything) i (?:eat|ate)|my (?:food|meals?|dinner|lunch|breakfast))`,
  ),
  safetyPhrase(
    String.raw`starv(?:e|es|ed|ing)\s+(?:myself|me|yourself)|starv${L}\s+(?:to|so i can|until i)\s+(?:lose|drop|get|be)`,
  ),
  safetyPhrase(
    String.raw`earn (?:my|the right to)\s+(?:food|meals?|dinner|lunch|eating|calories)|punish${L}\s+(?:myself|me)\s+(?:with|by|for)|to punish (?:myself|me)`,
  ),
  safetyPhrase(
    String.raw`laxativ${L}\s+(?:after|when|to)\s+${WORDS(1)}(?:binge${L}|eat${L}|meals?)`,
  ),
  safetyPhrase(
    String.raw`vyvol${L}\s+(?:si\s+)?(?:vracanie|zvracanie|zvraceni)`,
  ),
  safetyPhrase(
    String.raw`hladov(?:at|et|anie|eni|ka|ky|ke|ku|kou|im|ime|al|ala|ali|el|ela)|hladuj${L}`,
  ),
];

const DIURETIC_DRINK = safetyPhrase(
  String.raw`coffee|caffeine|tea|alcohol|beer|kav${L}|kofein${L}|caj${L}|alkohol${L}`,
);

/** Pairs that are only an eating-disorder signal together. */
const EATING_DISORDER_PAIRS: readonly (readonly [RegExp, RegExp])[] = [
  [
    safetyPhrase(
      String.raw`laxativ${L}|water pills?|diet pills?|ipecac|emetic${L}|senna|prehana${L}|projima${L}`,
    ),
    WEIGHT_LOSS_INTENT,
  ],
  [safetyPhrase(String.raw`vyvrac${L}|zvrac${L}|vracanie|vraceni`), FOOD_WORDS],
  [safetyPhrase(String.raw`potresta${L}|potrestat`), FOOD_WORDS],
  [
    safetyPhrase(String.raw`potresta${L}|potrestat`),
    safetyPhrase(String.raw`cvic${L}|trening${L}`),
  ],
];

const DIURETIC = safetyPhrase(String.raw`diuretic${L}|diuretik${L}`);

const isEatingDisorder = (text: string): boolean =>
  anyMatch(text, EATING_DISORDER) ||
  EATING_DISORDER_PAIRS.some(
    ([first, second]) => first.test(text) && second.test(text),
  ) ||
  (DIURETIC.test(text) &&
    WEIGHT_LOSS_INTENT.test(text) &&
    !DIURETIC_DRINK.test(text));

// ---------------------------------------------------------------------------
// Medical: requests to diagnose, prescribe or dose medication
// ---------------------------------------------------------------------------

const PRESCRIPTION_DRUGS = String.raw`medication${L}|medicine${L}|meds|drugs?|pills?|antibiotic${L}|antidepressant${L}|insulin|metformin|ozempic|wegovy|mounjaro|zepbound|saxenda|semaglutide|tirzepatide|liraglutide|steroid${L}|anabolic${L}|sarms?|testosterone|trenbolone|statin${L}|beta blocker${L}|blood pressure (?:meds|medication|pills)|thyroid (?:meds|medication)|ibuprofen|paracetamol|acetaminophen|aspirin|naproxen|diclofenac|tramadol|codeine|painkiller${L}`;

/** Training objects that make "diagnose" a coaching question. */
const TRAINING_OBJECTS = String.raw`${WORDS(3)}(?:bench|squat|deadlift|form|technique|plateau|stall${L}|program${L}|plan|lift${L}|run${L}|pace|split|stuck)`;

const BODY_PARTS = String.raw`knee|wrist|ankle|arm|leg|finger|toe|rib|hand|foot|shoulder|elbow|hip|back|nose|collarbone|bone|thumb|neck|spine|tendon|ligament|acl|meniscus|achilles|hamstring|calf|muscle|groin|quad|bicep|tricep|pec`;

const MEDICAL = [
  safetyPhrase(
    String.raw`(?:can|could|would|will|please)\s+(?:you\s+)?diagnose(?!\s+${TRAINING_OBJECTS})|diagnose\s+(?!${TRAINING_OBJECTS})(?:me|my|this|what|it)|(?:what(?:'s| is)|give me|tell me)\s+(?:a\s+|my\s+|the\s+)?diagnosis|^diagnose(?!\s+${TRAINING_OBJECTS})`,
  ),
  safetyPhrase(
    String.raw`prescribe\s+(?:me|my|something|some|a|an|medication|medicine|drugs?|pills?|treatment)|(?:can|could|would|will)\s+you\s+prescribe|write (?:me )?a prescription`,
  ),
  safetyPhrase(
    String.raw`(?:dose|dosage|how much|how many mg)\s+(?:of\s+)?${WORDS(2)}(?:${PRESCRIPTION_DRUGS})|(?:medication|medicine|drug|pill|steroid)\s+(?:dose|dosage)`,
  ),
  safetyPhrase(
    String.raw`(?:should|can|could)\s+i\s+(?:take|start|stop|quit|use|come off|skip)\s+${WORDS(2)}(?:${PRESCRIPTION_DRUGS})|what (?:medication|medicine|drugs?|pills?) (?:should|can|do) i`,
  ),
  safetyPhrase(
    String.raw`is (?:this|it|that)\s+${WORDS(2)}(?:cancer${L}|tumou?r|melanoma|fractured|a fracture|a tear|torn ligament|hernia|infected|an infection)|is my\s+(?:left\s+|right\s+)?(?:${BODY_PARTS})s?\s+(?:broken|fractured|torn|dislocated|ruptured)|do i have\s+(?:a\s+|an\s+)?(?:cancer|tumou?r|diabetes|hernia|fracture|torn${L}|broken${L}|infection|melanoma|sepsis)|what injury (?:do i|did i|is (?:this|it)|have i)|what(?:'s| is) my injury`,
  ),
  // Slovak and Czech.
  safetyPhrase(
    String.raw`diagnostikuj${L}|(?:moj${L}|aka|jaka|ake|stanov${L}|urc${L})\s+${WORDS(2)}diagnoz${L}|(?:mozes|vies|mohol by si|muzes|umis)\s+${WORDS(1)}diagnostik${L}`,
  ),
  safetyPhrase(
    String.raw`(?:prestat|prestanem|zacat|zacnem|vysadit|vysadim|prestal${L})\s+(?:uzivat\s+|brat\s+)?(?:liek${L}|lek|leky|leku|inzulin${L}|steroid${L}|antidepres${L})`,
  ),
  safetyPhrase(
    String.raw`predpis(?:te)?\s+mi|predepis${L}\s+mi|predpis${L}\s+(?:mi\s+)?(?:liek${L}|liecb${L}|lek|leky|leku|lecb${L})`,
  ),
  safetyPhrase(
    String.raw`davk${L}\s+${WORDS(1)}(?:liek${L}|lek|leku|leky|steroid${L}|inzulin${L})|ak(?:y|u|e|ym)\s+liek${L}|jak(?:y|ou|e|ym)\s+(?:lek|leky|leku)|ake zranenie|jake zraneni|je to\s+(?:rakovin${L}|zlomen${L}|nador${L}|natrhnut${L}|natrzen${L}|prietrz${L}|kyl${L})`,
  ),
];

// ---------------------------------------------------------------------------
// Dangerous targets: extreme deficits, multi-day fasts, rapid loss, pain
// ---------------------------------------------------------------------------

/** Above this weekly loss a goal is treated as a crash target. */
const MAX_SAFE_KG_PER_WEEK = 1.5;
/** Daily intake at or below this is treated as an extreme deficit. */
const MAX_EXTREME_DAILY_KCAL = 1000;
/** Fasts at least this long are treated as dangerous. */
const MIN_DANGEROUS_FAST_HOURS = 48;

// Accepts "1 500", "1.500" and "1,500"; the lookbehind stops "1 500" being
// read as 500.
const KCAL_NUMBER = String.raw`(?<![\p{L}\p{N}]|\d[ .,])(\d{1,3}(?:[ .,]\d{3})+|\d{1,5})`;
const KCAL = String.raw`kcals?|cals?|calories|calorie|kalori${L}|kcal`;
const DAILY = String.raw`(?:a|per|each|every|za|na|kazdy|denne)\s*(?:-\s*)?(?:day|den|dna)|/\s*(?:day|d|den)|daily|denne`;
const DEFICIT_CONTEXT =
  /(?:burn\p{L}*|deficit|surplus|cut(?:ting)?|reduc\p{L}*|less|fewer|extra|more|add\p{L}*|spal\p{L}*|walk\p{L}*|steps?)\s*$/u;
const MEAL_CONTEXT =
  /(?:snack|lunch|breakfast|dinner|meal|obed|olovrant|vecer\p{L}*|ranajk\p{L}*|desiat\p{L}*|svacin\p{L}*|snidan\p{L}*)/u;

const parseKcal = (value: string): number =>
  Number(value.replace(/[ .,]/g, ""));

const DAILY_KCAL = new RegExp(
  String.raw`${KCAL_NUMBER}\s*(?:-\s*)?(?:${KCAL})\s*(?:-\s*)?(?:${DAILY})(?![\p{L}\p{N}])`,
  "gu",
);
const CAPPED_KCAL = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:under|below|less than|fewer than|no more than|at most|max(?:imum)?(?: of)?|pod|menej ako|menej nez|mene nez|maximalne)\s+${KCAL_NUMBER}\s*(?:-\s*)?(?:${KCAL})(?![\p{L}\p{N}])`,
  "gu",
);
const ONLY_KCAL = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:only|just)\s+(?:eat|eating|allow myself|allowing myself|have|having|consume|consuming|jem|jim)\s+${KCAL_NUMBER}\s*(?:-\s*)?(?:${KCAL})(?![\p{L}\p{N}])`,
  "gu",
);
const DIET_KCAL = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:a|an|on|my|the|this|following|follow|start|try|do)\s+${KCAL_NUMBER}\s*(?:-\s*)?(?:${KCAL})\s*(?:-\s*)?diet${L}`,
  "gu",
);
const ZERO_KCAL = safetyPhrase(
  String.raw`(?:eat|eating|have|having)\s+(?:zero|no|0)\s+(?:calories|kcal)(?:\s+(?:a|per)\s+day)?(?!\s+(?:drinks?|sodas?|snacks?|sweetener${L}))`,
);
const DIET_OR_LOSS_CONTEXT = safetyPhrase(
  String.raw`diet${L}|cutting|cut|lose weight|weight loss|fat loss|chudn${L}|schudn${L}|hubn${L}|zhubn${L}|(?:a|per|each|every)\s+day|daily|denne|za den|na den`,
);

const nearMeal = (text: string, index: number, length: number): boolean =>
  MEAL_CONTEXT.test(text.slice(Math.max(0, index - 25), index + length + 25));

const hasExtremeIntake = (text: string): boolean => {
  for (const match of text.matchAll(DAILY_KCAL)) {
    const kcal = parseKcal(match[1] ?? "");
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    const after = text.slice(
      match.index + match[0].length,
      match.index + match[0].length + 20,
    );
    if (
      kcal <= MAX_EXTREME_DAILY_KCAL &&
      !DEFICIT_CONTEXT.test(before) &&
      !/^\s*(?:deficit|surplus|less|fewer|more|extra)/u.test(after) &&
      !nearMeal(text, match.index, match[0].length)
    )
      return true;
  }
  const dietContext = DIET_OR_LOSS_CONTEXT.test(text);
  for (const match of text.matchAll(CAPPED_KCAL)) {
    if (
      dietContext &&
      parseKcal(match[1] ?? "") <= MAX_EXTREME_DAILY_KCAL &&
      !nearMeal(text, match.index, match[0].length)
    )
      return true;
  }
  for (const pattern of [ONLY_KCAL, DIET_KCAL]) {
    for (const match of text.matchAll(pattern)) {
      if (
        parseKcal(match[1] ?? "") <= MAX_EXTREME_DAILY_KCAL &&
        !nearMeal(text, match.index, match[0].length)
      )
        return true;
    }
  }
  return ZERO_KCAL.test(text);
};

const DURATION_UNIT = String.raw`hours?|hrs?|h|days?|weeks?|dni|dny|dnu|den|dna|tyzd${L}|tyd${L}|hodin${L}`;
const FAST_LEAD = String.raw`fast|fasts|fasting|fasted|not eat(?:ing)?|(?:don'?t|do not|won'?t|will not|never)\s+eat(?:ing)?|stop eating|without eating|without food|no food|eat nothing|eating nothing|water only|only water|nothing but water|just water|skip(?:ping)? (?:all )?meals|only drink(?:ing)? water|drink(?:ing)? only water|(?:haven'?t|have not|hasn'?t|didn'?t)\s+(?:eaten|eat)\s+(?:anything\s+|any food\s+)?(?:in|for)`;
const FAST_LEAD_SK = String.raw`post(?:it|im|ime|ila|il|ovat|ovanie)?|nejest|nejist|nejem|nejim|nejedl${L}\s+(?:som|jsem)|nebudem\s+(?:nic\s+)?jest|nebudu\s+(?:nic\s+)?jist|bez jedla|bez jidla`;
const FAST_PATTERNS = [
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:${FAST_LEAD})\s+(?:anything\s+|at all\s+)?(?:for\s+)?(?:about\s+|around\s+|over\s+|a full\s+|the next\s+|next\s+)?(${NUMBER})\s*(?:-\s*)?(?:whole\s+|full\s+|entire\s+)?(${DURATION_UNIT})(?![\p{L}\p{N}])`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(${NUMBER})\s*(?:-\s*)?(${DURATION_UNIT}|denn${L}|dnov${L}|tyzdenn${L}|hodinov${L})\s+(?:long\s+)?(?:water\s+|dry\s+|juice\s+|extended\s+|prolonged\s+)?(?:fast|fasts|fasting|post|postu|hladovk${L})(?![\p{L}\p{N}])`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:${FAST_LEAD_SK})\s+(?:sa\s+|se\s+)?(?:(?:uz|nic|celkom)\s+)*(?:na\s+|po\s+|cely(?:ch)?\s+|celych\s+)?(${NUMBER})\s*(${DURATION_UNIT})(?![\p{L}\p{N}])`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(${NUMBER})\s*(${DURATION_UNIT})\s+(?:nic\s+)?(?:nejest|nejist|nejem|nejim)(?![\p{L}\p{N}])`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:eat|eating)\s+(?:only\s+)?once\s+every\s+(${NUMBER})\s*(${DURATION_UNIT})(?![\p{L}\p{N}])`,
    "gu",
  ),
];
/** "5 days a week" is a schedule, not a fast length. */
const FREQUENCY_AFTER =
  /^\s+(?:(?:a|per|each|every|v|za|in a|out of)\s+(?:week|tyzd\p{L}*|tyd\p{L}*)|out of \d+)/u;
const RELIGIOUS_FAST = safetyPhrase(
  String.raw`ramadan|ramazan|lent fast${L}|during lent|for lent|lenten|velk${L} post|postne obdobie|postni doba`,
);
/** Water, dry and juice fasts are never covered by the religious exemption. */
const EXTENDED_FAST = safetyPhrase(String.raw`(?:water|dry|juice) fast${L}`);

const RELIGIOUS_NEARBY = 40;

const hasDangerousFast = (text: string): boolean =>
  FAST_PATTERNS.some((pattern, patternIndex) =>
    [...text.matchAll(pattern)].some((match) => {
      const hours = unitHours(match[2] ?? "");
      const after = text.slice(match.index + match[0].length);
      if (hours === null) return false;
      if (toNumber(match[1]) * hours < MIN_DANGEROUS_FAST_HOURS) return false;
      // "N-day fast" names a fast length even when a schedule follows.
      if (patternIndex !== 1 && FREQUENCY_AFTER.test(after)) return false;
      // Ramadan or Lent day counts ("Ramadan fasting 30 days") describe a
      // daily daytime fast; water, dry and juice fasts are never exempt.
      const religious =
        patternIndex === 0 &&
        /^(?:fast|fasts|fasting|fasted)\s/u.test(match[0]) &&
        RELIGIOUS_FAST.test(
          text.slice(
            Math.max(0, match.index - RELIGIOUS_NEARBY),
            match.index + match[0].length,
          ),
        ) &&
        !EXTENDED_FAST.test(text);
      return !religious;
    }),
  );

const RAPID_LOSS_PATTERNS = [
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:lose|losing|drop|dropping|shed|shedding|cut|get rid of)\s+(${NUMBER})\s*(kg|kgs|kilos?|kilograms?|lbs?|pounds?)\s+(?:of\s+(?:fat|weight)\s+)?(?:in|within|over|by|after)\s+(?:the next\s+|next\s+|just\s+|only\s+|less than\s+)?(?:(${NUMBER})\s*)?(days?|weeks?|months?)(?![\p{L}\p{N}])`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:schudnut|schudnem|zhodit|zhodim|zhubnout|zhubnu|shodit|shodim|stratit|stratim|dat dole|dostat dole)\s+(${NUMBER})\s*(kg|kil${L})\s+(?:za|do|behem|pocas|cez|v priebehu)\s+(?:(${NUMBER})\s*)?(dni|dny|dnu|den|dna|tyzd${L}|tyd${L}|mesiac${L}|mesic${L})(?![\p{L}\p{N}])`,
    "gu",
  ),
];
/** Asking whether a pace is safe is a question for the Coach to answer. */
const PACE_QUESTION = safetyPhrase(
  String.raw`is (?:it|that|this) (?:safe|ok|okay|possible|realistic|healthy|dangerous|bad|too fast)|je (?:to|bezpecne|realne|zdrave)`,
);

const RECKLESS_INTENT = safetyPhrase(
  String.raw`starv${L}|don'?t care|anything|whatever it takes|no matter|hladov${L}|je mi jedno`,
);

const hasRapidLossTarget = (text: string): boolean =>
  !(PACE_QUESTION.test(text) && !RECKLESS_INTENT.test(text)) &&
  RAPID_LOSS_PATTERNS.some((pattern) =>
    [...text.matchAll(pattern)].some((match) => {
      const amount = toNumber(match[1]);
      const kg = /^(?:lbs?|pounds?)$/u.test(match[2] ?? "")
        ? amount * 0.4536
        : amount;
      const hours = unitHours(match[4] ?? "");
      if (hours === null) return false;
      const weeks = (toNumber(match[3]) * hours) / (24 * 7);
      return weeks > 0 && kg / weeks > MAX_SAFE_KG_PER_WEEK;
    }),
  );

const THROUGH_PAIN = [
  safetyPhrase(
    String.raw`(?:push|pushing|pushed|train|training|lift|lifting|run|running|work|working|squat${L}|keep going|power|play|playing)\s+(?:on\s+)?(?:through|despite|past)\s+(?:the\s+|my\s+|this\s+|that\s+|a\s+)?${WORDS(3)}(?:pains?|injur${L})|ignore (?:the |my )?pain`,
  ),
  safetyPhrase(
    String.raw`(?:cvic${L}|trenova${L}|trenuj${L}|beha${L}|pokracova${L}|tlac${L}|zabera${L})\s+(?:aj\s+|i\s+)?(?:napriek|cez|pres|navzdory|s)\s+${WORDS(2)}bolest${L}|ignoruj${L} bolest${L}`,
  ),
];
/** Ordinary training discomfort, not injury pain. */
const TRAINING_DISCOMFORT = safetyPhrase(
  String.raw`doms|muscle soreness|sore muscles|svalov${L}|svalovic${L}|svalu|the burn|pain of (?:the|a|my) (?:last|final|hard|tough)`,
);
const DAILY_MAXING = safetyPhrase(
  String.raw`(?:max out|maxing out|one rep max|1rm|test my max)\s+${WORDS(3)}(?:every|each)\s+(?:single\s+)?day|(?:max out|maxing out)\s+daily`,
);

const HIGH_VOLUME = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d{2,3})\s+(?:sets?|serii|serie)\s+(?:to failure\s+|do zlyhania\s+|do selhani\s+)?(?:(?:every|each|a|per)\s+day|daily|kazdy den|denne)(?![\p{L}\p{N}])`,
  "gu",
);

const hasDangerousTarget = (text: string): boolean =>
  hasExtremeIntake(text) ||
  hasDangerousFast(text) ||
  hasRapidLossTarget(text) ||
  (anyMatch(text, THROUGH_PAIN) && !TRAINING_DISCOMFORT.test(text)) ||
  DAILY_MAXING.test(text) ||
  [...text.matchAll(HIGH_VOLUME)].some((match) => Number(match[1]) >= 40);

// ---------------------------------------------------------------------------
// Prompt injection
// ---------------------------------------------------------------------------

const PROMPT_INJECTION = [
  /\bignore (all |the )?(previous|system|developer|visual) (instructions|contents)\b/,
  /\breveal (the )?(system prompt|hidden instructions|developer secrets|secrets)\b/,
  /\bact as root\b/,
  /\[?system (override|command)\]?/,
  /\b(grant admin privileges|delete records from all user databases)\b/,
  /\b(print|reveal|output|dump)\s+[^.]{0,120}?(user profiles|root credentials|system prompt|developer secrets|auth tokens|connection strings|secrets)\b/,
  /\b(print|reveal|output|dump|show)\s+[^.]{0,120}?(hidden instructions|system instructions|api keys?|passwords?|service[- ]role keys?)\b/,
  /\bignoruj\p{L}* (vsetky |vsechny )?(predchadzajuce|predosle|predchozi|systemove) (pokyny|instrukcie|instrukce)\b/u,
  /\bodhal (systemovy prompt|tajne pokyny)\b/,
];

// ---------------------------------------------------------------------------
// Soft redirect: answer normally, then point to a professional
// ---------------------------------------------------------------------------

const ADVISORY_TOPICS = [
  safetyPhrase(
    String.raw`pain|pains|painful|hurts?|hurting|injur${L}|sprain${L}|tendinit${L}|tendonit${L}|diagnosed|medication${L}|medicine${L}|meds|prescri${L}|pregnan${L}|postpartum|diabet${L}|asthma${L}|blood pressure|hypertension|heart (?:attack|condition)|medical condition|epilep${L}|seizure${L}|anaphyla${L}|allerg${L}|passed out|fainted|(?:doctor|physio${L}) (?:said|told)|ramadan`,
  ),
  safetyPhrase(
    String.raw`bolest${L}|boli (?:ma|me|mne)|bolia (?:ma|me)|zranen${L}|lieky|liek${L}|leky|tehotn${L}|cukrovk${L}|astm${L}|diagnostikoval${L}|infarkt${L}|alergi${L}`,
  ),
];

export const COACH_SAFETY_ADVISORY =
  "This is general fitness guidance, not medical advice. For pain, an injury, medication or a medical condition, check with a doctor or physiotherapist. If symptoms are severe or sudden, stop and call 112 (EU) or your local emergency number.";

// ---------------------------------------------------------------------------
// Fixed responses. The app is English-only; 112 works across the EU.
// ---------------------------------------------------------------------------

export const COACH_SAFETY_RESPONSES: Readonly<Record<SafetyCategory, string>> =
  {
    emergency:
      "This may need urgent medical help. If you or someone with you is in danger, call 112 now (Slovakia and the rest of the EU) or your local emergency number, and stop any exercise. Mizyun cannot assess emergencies.",
    self_harm:
      "I’m really sorry you’re going through this, and I’m glad you said something. Mizyun can’t give you the support you need right now, but people can. If you might act on these thoughts or you are in danger, call 112 now (Slovakia and the rest of the EU) or your local emergency number. If you can, contact someone you trust and ask them to stay with you, or speak to a doctor or a crisis line.",
    eating_disorder:
      "I’m sorry this feels hard. I can’t help with restriction, purging, laxatives or exercise used as punishment, but a doctor or registered dietitian can give you proper support. If you feel faint or physically unwell, call 112 (EU) or your local emergency number.",
    medical:
      "I can provide general fitness and nutrition education, but I can’t diagnose, prescribe, give medication doses, or assess an injury. Please take this question to a doctor or pharmacist.",
    dangerous_target:
      "I can’t help with very low intake, multi-day fasting, rapid weight-loss targets, extreme training volume, or training through pain. I can help you set a gradual target instead; if pain or a health condition is involved, check with a doctor or physiotherapist first.",
    prompt_injection:
      "I can help with your confirmed Mizyun fitness and nutrition records, but I can’t change or reveal the system’s instructions or access controls.",
  };

const blocked = (category: SafetyCategory): SafetyDecision => ({
  allowed: false,
  category,
  response: COACH_SAFETY_RESPONSES[category],
});

/** True when the text contains self-harm or suicide language. */
export const containsSelfHarmLanguage = (rawText: string): boolean =>
  anyMatch(normalizeSafetyText(rawText), SELF_HARM);

/**
 * Deterministic first-line safety boundary for user text (chat messages,
 * meal and activity descriptions, saved memories). It protects critical
 * fixed cases even when the provider is disabled or unavailable. Blocks are
 * reserved for crisis, eating-disorder, diagnosis/prescription,
 * dangerous-target and prompt-injection requests; ordinary questions that
 * mention pain, injury, medication or a condition pass with an advisory note.
 */
export const screenCoachInput = (rawText: string): SafetyDecision => {
  const text = normalizeSafetyText(rawText);
  const breathingDifficulty = anyMatch(text, BREATHING_DIFFICULTY);
  const breathingTechnique =
    breathingDifficulty && isBreathingTechniqueQuestion(text);
  if (isEmergency(text) || (breathingDifficulty && !breathingTechnique))
    return blocked("emergency");
  if (anyMatch(text, SELF_HARM)) return blocked("self_harm");
  if (isEatingDisorder(text)) return blocked("eating_disorder");
  if (anyMatch(text, MEDICAL)) return blocked("medical");
  if (hasDangerousTarget(text)) return blocked("dangerous_target");
  if (anyMatch(text, PROMPT_INJECTION)) return blocked("prompt_injection");
  if (breathingTechnique || anyMatch(text, ADVISORY_TOPICS))
    return { allowed: true, advisory: COACH_SAFETY_ADVISORY };
  return { allowed: true };
};

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

/**
 * A warning clause ("don't fast for 5 days") is removed before matching.
 * Negated eating ("never eat more than 800 kcal") is itself the harm, so a
 * clause about eating or food is never removed.
 */
const NEGATED_CLAUSE =
  /(?<![\p{L}\p{N}])(?:don'?t|do not|never|avoid(?:ing)?|not recommended(?: to)?|unsafe to|instead of|rather than|nikdy|nerob\p{L}*|vyhn\p{L}*)\s+[^,;:]*/gu;
const KEEP_NEGATED_CLAUSE =
  /(?<![\p{L}])(?:eat\p{L}*|food|meals?|kcal|calori\p{L}*|hesitate|worry|be afraid|jest|jist|jedl\p{L}*|jidl\p{L}*)(?![\p{L}])/u;
/** A verdict that its own clause describes something to avoid. */
const NEGATIVE_VERDICT = safetyPhrase(
  String.raw`(?:is|are|'s)\s+(?:not recommended|not safe|unsafe|dangerous|unrealistic|risky|harmful|a bad idea|not (?:a\s+)?(?:safe|healthy|good))|(?:isn'?t|aren'?t)\s+(?:a\s+)?(?:safe|healthy|recommended|good)`,
);
const CLAUSE_BREAK =
  /,|;|\s(?:so|but|however|though|although|whereas|yet|and then)\s/u;

/**
 * Screens model-written advice. Unlike the input screen it does not treat a
 * cautionary mention ("stop if you feel chest pain") as the user's intent:
 * it blocks self-harm language and, per clause, eating-disorder or
 * dangerous-target instructions. A clause carrying a negative verdict is
 * skipped, and explicit warning clauses are removed, except about eating.
 */
export const screenCoachOutput = (rawText: string): SafetyDecision => {
  if (containsSelfHarmLanguage(rawText)) return blocked("self_harm");
  for (const rawSentence of rawText.split(/(?<=[.!?;])\s+|\n+/u)) {
    const sentence = normalizeSafetyText(rawSentence);
    const clauses = sentence
      .split(CLAUSE_BREAK)
      .filter((clause) => !NEGATIVE_VERDICT.test(clause))
      .map((clause) =>
        clause.replace(NEGATED_CLAUSE, (warning) =>
          KEEP_NEGATED_CLAUSE.test(warning) ? warning : " ",
        ),
      );
    // Check each remaining clause and the joined sentence, so a target split
    // across a comma ("Instead of 2000 kcal, eat 700 kcal a day") still counts.
    for (const instruction of [...clauses, clauses.join(" ")]) {
      if (isEatingDisorder(instruction)) return blocked("eating_disorder");
      if (hasDangerousTarget(instruction)) return blocked("dangerous_target");
    }
  }
  return { allowed: true };
};
