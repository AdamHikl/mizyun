/**
 * AI-ACT-001 — conservative meal-logging intent detection.
 *
 * The Coach diverts explicit first-person food statements and logging
 * commands into the nutrition draft provider. Everything else — including
 * all training content — continues through the grounded text Coach.
 *
 * Two safeguards keep training content out of the meal draft path
 * (which would burn a draft slot and present the wrong UI):
 *
 * 1. A workout signal — workouts/training/exercise/sessions plus common
 *    activity and exercise names, including plurals ("workouts", "squats",
 *    "walk", "run", ...) — vetoes meal routing outright.
 * 2. The statement must carry food context: a quantity with a unit
 *    ("180 g", "two eggs" is covered by the food-word path below) or a
 *    common food/drink word. A bare command such as "Add two hour walk to
 *    my completed workouts today" matches neither.
 *
 * The lists are intentionally conservative and not exhaustive: when in
 * doubt the statement stays with the grounded Coach, which can still help
 * with meals. Missing a meal phrase costs a rephrase; misrouting a workout
 * into a meal draft costs a draft slot and user trust.
 */

const workoutSignal =
  /\b(?:workouts?|train(?:ing|ed|s?)|exercises?|sessions?|walk(?:ed|ing|s?)?|jog(?:ged|ging|s?)?|ran|running|runs?|rode|rides?|swam|swimming|swims?|cycl(?:ed|ing|es?)|hik(?:ed|ing|es?)|sprint(?:ed|ing|s?)|lift(?:ed|ing|s?)|cardio|gym|hiit|reps?|sets?|squats?|deadlifts?|bench(?:press)?|presses?|curls?|lunges?|planks?|pushups?|pullups?|burpees?|cvičeni\w*|tréning\w*)\b/i;

const foodQuantity =
  /(?:\d+(?:[.,]\d+)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)\s*(?:g\b|grams?|kg\b|kilograms?|kilos?|oz\b|ounces?|ml\b|l\b|litres?|liters?|cups?|tbsp|tsp|slices?|pieces?|portions?)/i;

const foodWord =
  /\b(?:breakfast|lunch|dinner|supper|snacks?|meals?|drinks?|juice|smoothie|coffee|tea|water|milk|yogurt|yoghurt|cheese|butter|cream|eggs?|omelette|toast|bread|bagels?|baguette|crackers?|cereal|oatmeal|oats?|porridge|rice|pasta|noodles?|quinoa|couscous|pizza|burgers?|sandwich|wrap|waffles?|pancakes?|soup|stew|salads?|sushi|sashimi|chicken|beef|pork|lamb|turkey|tuna|salmon|fish|shrimp|prawns?|steak|bacon|ham|sausage|potatoes?|carrots?|broccoli|spinach|kale|cucumber|tomatoes?|avocado|bananas?|apples?|oranges?|mango|grapes?|berries?|strawberries?|blueberries?|chocolate|cocoa|honey|jam|peanuts?|almonds?|walnuts?|cashews?|nuts?|seeds?|protein bars?|protein|carbs?|fats?|raňajky|obiad|večera|večeru|svažina|ryža|kuskus|chlieb|vajíčka|vajcia|kuracie|kuracím|tuniak|mlieko|syry|maslo|jablká|hrozno|banány|káva|čaj|voda)\b/i;

const hasFoodContext = (text: string): boolean =>
  foodQuantity.test(text) || foodWord.test(text);

const mealLoggingPhrases: readonly RegExp[] = [
  /^(?:please\s+)?(?:log|add|record)\b/i,
  /\bi\s+(?:ate|consumed)\b/i,
  /\bi\s+had\b/i,
  /\bi['’]ve\s+(?:eaten|had)\b/i,
  /\b(?:zjedol|zjedla|jedol som|jedla som|mal som|mala som)\b/i,
  /^(?:prosím\s+)?(?:zapíš|pridaj|zaloguj)\b/i,
];

export const isExplicitMealLoggingIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    !workoutSignal.test(normalized) &&
    hasFoodContext(normalized) &&
    mealLoggingPhrases.some((pattern) => pattern.test(normalized))
  );
};
