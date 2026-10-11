# Automatic meal illustration atlas

`food-atlas-v1.png` is a bundled decorative AI-generated PNG atlas (1254 ×1254, alpha), created2026-10-09 with the built-in imagegen tool. No user meal, photo or health data was used. The source remains in the local generated-images library; the consuming copy is in this repository.

The original square asset contains a uniform4×4 grid. `meal-illustration-catalog.ts` maps English/Slovak/Czech food terms to the corresponding cell, and `MealIllustrationTile` clips one60×60 display cell from a240×240 rendered atlas. The illustration is an approximate visual category, never evidence of ingredients, portion size or nutrition. The neutral final cell is no longer rendered: unmatched meals allocate no visual placeholder.

Prompt used:

> Use case: stylized-concept. Asset type: a SINGLE production food-icon sprite atlas for a private fitness meal history app. Generate a square PNG with transparent background, arranged in an EXACT uniform4 by4 grid. No grid lines, no labels, no text, no watermark. Each cell has exactly one isolated food illustration centered with generous clear padding inside the cell; nothing crosses cell boundaries. Equal icon scale. Style: polished softly shaded3D emoji-like food, appetizing natural colors, clean strong silhouette readable at60 pixels, gentle top-left lighting, no faces. These are decorative illustrations, not realistic photos. Exact order from top-left left-to-right: row1 oatmeal in a bowl with a few berries; bowl of pasta with tomato sauce; chicken breast with rice on a plate; green mixed salad in a bowl. row2 sandwich with lettuce and cheese; slice of pizza; two fried eggs on a small plate; salmon fillet on a small plate. row3 bowl of soup; yogurt in a bowl with berries; small mixed fruit arrangement banana and apple; a coffee cup. row4 bread loaf with one slice; small steak on a plate; a chocolate muffin; a neutral white plate with fork and spoon as universal meal fallback. Transparent outside all objects including clear gaps between all sixteen cells. Composition must be precise uniform grid, every cell the same width and height, image square.

Original tool prompt contained ordinary spaces before numeric units. Visual atlas inspection and alpha/dimension checks passed; native cropping, dark/light rendering and accessibility require exact-candidate acceptance.

## Supplemental catalog / Pro follow-up

`food-atlas-v2-supplement.png` was created2026-10-09 with built-in imagegen, matching the original as a visual reference. It is1254×1254 with alpha, a uniform4×4 grid. Row-major order: toast, pudding, banana, rice; potatoes, pancakes, cereal, smoothie; milk, cheese, croissant, protein bar; sushi, burrito, nuts, ice cream. Generated source: `exec-78e798c4-b32e-49bb-bfe8-e65b0afb760d.png` in the local generated-images library. Only synthetic food concepts were used; no account data. The consuming PNG was copied without image modification. Visual order and dimensions/alpha inspected; native dark/light/clipping acceptance remains open.

Prompt requirements: generate a new transparent square4×4 atlas matching the reference's polished softly shaded3D food style; equal cell sizes, centered food with12percent clear padding and no overlap; exact row-major foods above; no text, branding, faces or empty plate. Toast depicts two peanut-butter-and-jelly slices; pudding a vanilla cup; banana partially peeled; protein bar unwrapped; burrito cut to reveal beans/rice.

The catalog costs no per-meal image generation. Approximate artwork remains decorative and is displayed only under the Pro visual capability, independently of consent needed for private custom generation.
