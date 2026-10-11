/** Decorative categories only. Never used to infer ingredients or nutrition. */
export const MEAL_ILLUSTRATION_STYLE = "food-atlas-v2";
export type MealIllustrationKind =
  | "oatmeal"
  | "pasta"
  | "chicken"
  | "salad"
  | "sandwich"
  | "pizza"
  | "eggs"
  | "fish"
  | "soup"
  | "yogurt"
  | "fruit"
  | "coffee"
  | "bread"
  | "steak"
  | "dessert"
  | "toast"
  | "pudding"
  | "banana"
  | "rice"
  | "potatoes"
  | "pancakes"
  | "cereal"
  | "smoothie"
  | "milk"
  | "cheese"
  | "croissant"
  | "protein-bar"
  | "sushi"
  | "burrito"
  | "nuts"
  | "ice-cream"
  | "meal";

const kinds: readonly MealIllustrationKind[] = [
  "oatmeal",
  "pasta",
  "chicken",
  "salad",
  "sandwich",
  "pizza",
  "eggs",
  "fish",
  "soup",
  "yogurt",
  "fruit",
  "coffee",
  "bread",
  "steak",
  "dessert",
  "meal",
];
const supplementalKinds: readonly MealIllustrationKind[] = [
  "toast",
  "pudding",
  "banana",
  "rice",
  "potatoes",
  "pancakes",
  "cereal",
  "smoothie",
  "milk",
  "cheese",
  "croissant",
  "protein-bar",
  "sushi",
  "burrito",
  "nuts",
  "ice-cream",
];
const rules: readonly [MealIllustrationKind, RegExp][] = [
  [
    "oatmeal",
    /\b(oats?|oatmeal|porridge|granola|muesli|musli|ovsena|ovsene)\b/,
  ],
  [
    "protein-bar",
    /\b(protein (?:bar|bars)|proteinov[ay] tycink[ay]|proteinove tycinky)\b/,
  ],
  ["pudding", /\b(pudding|puddings|puding|pudink)\b/],
  ["pancakes", /\b(pancakes?|palacinky|palacinka|lievance|livance)\b/],
  ["sushi", /\b(sushi)\b/],
  ["burrito", /\b(burritos?)\b/],
  ["smoothie", /\b(smoothies?|shake|shakes)\b/],
  ["ice-cream", /\b(ice cream|gelato|zmrzlina|zmrzlinu)\b/],
  ["croissant", /\b(croissants?)\b/],
  ["pizza", /\b(pizza|pizzu)\b/],
  [
    "sandwich",
    /\b(sandwich|sandwiches|toastie|burger|wrap|sendvic|sendvice|bageta)\b/,
  ],
  [
    "pasta",
    /\b(pasta|spaghetti|noodles|lasagn[ae]|penne|macaroni|cestoviny|spagety|rezance)\b/,
  ],
  ["soup", /\b(soup|broth|stew|polievka|polievku|vyvar)\b/],
  ["salad", /\b(salad|salat|salatu)\b/],
  ["yogurt", /\b(yogurt|yoghurt|jogurt|skyr)\b/],
  [
    "eggs",
    /\b(eggs?|omelette|omelet|vajce|vajcia|vajicka|omeleta|prazenica)\b/,
  ],
  ["fish", /\b(salmon|fish|tuna|cod|trout|losos|ryba|ryby|tuniak|pstruh)\b/],
  ["chicken", /\b(chicken|turkey|kuracie|kuraci|kuracim|kura|morcacie)\b/],
  ["steak", /\b(steak|beef|pork|hovadzie|bravcove)\b/],
  [
    "dessert",
    /\b(muffin|cake|cookie|cookies|brownie|dessert|kolac|kolacik|dezert)\b/,
  ],
  ["banana", /\b(bananas?|banan|banany)\b/],
  [
    "fruit",
    /\b(fruit|banana|bananas|apple|apples|berries|orange|ovocie|banan|banany|jablko|jablka)\b/,
  ],
  ["coffee", /\b(coffee|espresso|cappuccino|latte|kava|kavu)\b/],
  ["toast", /\b(toasts?|toasty|toastu|toust|tousty)\b/],
  ["rice", /\b(rice|ryza|ryzu|ryze|ryzi)\b/],
  ["potatoes", /\b(potatoes|potato|zemiaky|zemiak|brambory|brambor)\b/],
  ["cereal", /\b(cereal|cereals|cerealie|cerealii)\b/],
  ["milk", /\b(milk|mlieko|mleko)\b/],
  ["cheese", /\b(cheese|cheeses|syr|syra)\b/],
  ["nuts", /\b(nuts|almonds?|walnuts?|peanuts?|orechy|mandle|mandli)\b/],
  ["bread", /\b(bread|toast|bagel|chlieb|pecivo|rozok|rohlik)\b/],
];

export function selectMealIllustration(name: string): {
  readonly kind: MealIllustrationKind;
  readonly atlas: "base" | "supplement";
  readonly row: number;
  readonly column: number;
  readonly matched: boolean;
} {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const kind =
    rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "meal";
  const supplementIndex = supplementalKinds.indexOf(kind);
  const index = supplementIndex >= 0 ? supplementIndex : kinds.indexOf(kind);
  return {
    kind,
    atlas: supplementIndex >= 0 ? "supplement" : "base",
    row: Math.floor(index / 4),
    column: index % 4,
    matched: kind !== "meal",
  };
}
