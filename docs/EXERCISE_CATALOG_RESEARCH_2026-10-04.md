# Exercise catalog replacement research

Researched 2026-10-04 for Adam's request to replace difficult names and unclear form guidance, while preparing for demonstrations later. **Current direction: use a free source now; keep ExerciseDB.io as a possible future upgrade.** Recommend **RepDB Free** as the replacement candidate to evaluate and adapt. It has 609 entries, clear separate descriptions/steps/tips and free commercial in-app rights with attribution. Its smaller catalog and content still need coverage and form review before import. ExerciseDB.io's paid package is deferred. The approved free-source plan is now implemented locally:609 adapted browse entries, original888 definitions archived for saved IDs, linked credit, structured form and pending demonstrations. No purchase, deployment, professional content acceptance or release has occurred.

## Current catalog evidence

Audited source HEAD `55338240639e44e0c609477db0cfa09a3abe8655`; the catalog, catalog contract and library modal have no local diff. Other sessions' dirty work is preserved. Source: [catalog](../packages/core/src/exercise-catalog.ts), [contract](../packages/contracts/src/exercise.ts), [library](../apps/mobile/src/features/workouts/exercise-library-modal.tsx), and [requirements EX-02 and WO-06](PRODUCT_REQUIREMENTS.md#exercise-and-workouts).

There are **888 built-in exercise records with 888 unique IDs**. Custom exercises created by individual users are additional and were not queried. The breakdown is 593 strength, 124 stretching, 61 plyometrics, 38 powerlifting, 35 Olympic weightlifting, 21 strongman and 16 cardio.

The live [free-exercise-db JSON](https://github.com/yuhonas/free-exercise-db/blob/main/dist/exercises.json) contains 876 entries. Comparing case-insensitive names finds 873 current matches; 867 also have identical instruction arrays. This establishes substantial content overlap, rather than proving the original import's provenance. Reimporting it would preserve most of the reported problems. Its [license](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md) is Unlicense; its images are static poses rather than complete motion demonstrations.

Observed defects and gaps:

- Five current entries have no instructions: Iron Cross, One-Arm Kettlebell Swings, Push Press, Side Bridge and Side Jackknife.
- Names such as Adductor, Spell Caster and Rickshaw Carry do not explain the movement to an unfamiliar user. Adductor's text describes foam rolling but its equipment says bodyweight. Rickshaw Carry requires a frame but also says bodyweight. These are catalog facts, not a completed biomechanical audit.
- The library displays only the first 60 matches, with no pagination. Search checks name and primary muscles, despite the placeholder promising equipment search. Common aliases are used by a separate lookup function, not this picker search; abbreviations such as RDL therefore need explicit picker support.
- The modal places the entire instructions array inside one text element rather than rendering numbered steps. Its current "science-backed" claim has no per-entry evidence in the catalog and should be removed or supported during implementation.
- No current catalog fields describe media rights, animation variant or form-review provenance. Tests check structural validity, not form correctness.

## Replacement options

Counts describe entries, including equipment and movement variants, not distinct fundamental movement patterns. Prices and policies were checked on the research date and must be refreshed before purchase.

| Candidate                                                                      | Count and difference from 888                     | Reuse and demonstrations                                          | Assessment                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [ExerciseDB.io Starter](https://exercisedb.io/pricing)                         | 1,394 supplier entries; +506, about +57%          | $199 once; downloadable JSON and 180/360px GIFs                   | Future upgrade only; outside the current zero-cost scope                                    |
| [RepDB Free](https://github.com/RepDB/exercise-dataset)                        | 609 counted records; −279                         | Free commercial in-app use with attribution; static illustrations | Recommended current free candidate; verify coverage and adapt content                       |
| [MuscleWiki official API](https://api.musclewiki.com/faq)                      | 1,943 supplier entries; +1,055                    | Paid direct API access starts at $10/month; MP4 demonstrations    | Hosted alternative; standard terms do not support permanent local catalog/media storage     |
| [ExerciseDB by AscendAPI](https://docs.ascendapi.com/products/edb-v1/overview) | V1 free 1,500, paid 2,000+; V2 11,000+ advertised | Hosted GIF/video API; storage depends on plan/agreement           | Different product from ExerciseDB.io; larger count does not establish better naming or form |
| [wger](https://wger.readthedocs.io/en/latest/api/api.html)                     | Usable English count unverified                   | Per-entry Creative Commons content rights; images and videos      | Open option, but completeness and full motion coverage were not established                 |

**App counts after replacement are not yet established.** A full accepted ExerciseDB.io import would provide 1,394 active supplier entries before deduplication, exclusions or retained Mizyun-only additions. A full RepDB Free import would provide 609 before those adjustments. The app still has 888 today. Do not sum the old and new catalogs: overlapping movements need mapping, not duplicate picker rows. Count accepted active entries separately from archived legacy IDs and user custom exercises.

### ExerciseDB.io as a future upgrade

Its [FAQ](https://exercisedb.io/faq) and [terms](https://exercisedb.io/terms) allow adapting the data and storing the licensed files in the app's own stack. Supplier IDs pair with GIF filenames. This fits the existing bundled catalog and avoids an ongoing provider dependency. Pro costs $599 and adds taxonomy, relationships and larger GIFs, without adding exercise entries. Starter is enough for the stated scope; Mizyun must still supply its reviewed movement patterns, equipment requirements and limitation policies.

The full purchased files and included EULA have not been inspected. Content rights must stay attached to the licensed product; raw data/media redistribution is prohibited. Keep licensed source files out of a public dataset or repository publication. Updates are not included by default. The public bench-press sample omits some setup/finish detail; the Pro sample recommends guillotine bench press as a progression through difficulty metadata. These findings rule out importing supplier training relationships as authoritative rules without separate review.

### RepDB Free as the current recommendation

Downloaded [RepDB's public JSON](https://exercise-dataset.com/exercises.json): **609 unique IDs, zero empty English instruction arrays**. Sampled ab-wheel, bench-press, deadlift and split-squat entries use short steps and separate tips. This is an improvement in presentation structure, not proof of every entry's correctness. Several sampled entries include broad tags such as shoulder_safe or lower_back_safe; exclude these from medical suitability or limitation decisions. Some equipment requirements are only implicit in tags. RepDB's [free license](https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md) requires attribution and forbids redistribution as a dataset/API. Its artwork is described as AI-generated and needs visual form review.

RepDB [Standard](https://repdb.co/) costs $499 once; its [current README](https://github.com/RepDB/exercise-dataset#free-vs-paid-tiers) distinguishes **497 motion animations and 112 static entries**. That does not meet full motion coverage for all 609 by itself. Preview animations are evaluation-only. The free license also prohibits using its images as input, reference or conditioning for generative models; do not generate animations from those illustrations without separate permission. This makes RepDB a practical free text/illustration starting point, with later licensed or independently commissioned media for uncovered entries.

Further zero-cost audit on 2026-10-04: the 609 entries comprise 494 strength, 79 stretching, 18 cardio, 14 Olympic and 4 plyometric records. Every entry has an English description, instruction array and tips array. Familiar movements are present: squat variants, dumbbell Romanian deadlift, leg press, lat pulldown, pec deck, machine leg curl/extension, calf raises, hip thrust, face pull, walking, stationary bike and plank. These checks establish useful mainstream coverage, not a complete match for every existing variant.

Only 107 current names match RepDB after normalizing case and punctuation. This is a naming comparison, not a count of equivalent movements: many variants have different names. An explicit mapping pass is mandatory. Of 609 records, 184 omit the equipment field; many are bodyweight, but importer logic must inspect instructions and support/anchor tags rather than assuming all missing equipment means no equipment. A complete review may retain or independently author missing common movements; do not remove currently referenced routine/history definitions to hit the supplier's count.

The independent audit found specific corrections to carry into the import: Bodyweight Overhead Press describes a pike push-up; Incline Push-Up requires stable elevated support despite omitting equipment. Running and walking text also contain unsupported universal injury/recovery claims that need removal or qualification. Swimming and outdoor cycling are not present under those activities in this snapshot; preserve supported existing variants or author needed additions separately. These findings support adaptation of the free source, not a claim that it is ready untouched.

**Zero-cost implementation direction:** use RepDB's free text and metadata as the candidate foundation, add the required credit, normalize names/aliases, write clear numbered form instructions with sources and review, and keep all animation references pending. Static illustrations are optional and need visual acceptance separately. Exclude the paid preview assets. Keep imported licensed content inside the application; a generic public exercise-data API or republished raw dataset is outside the stated license. No paid source or subscription is required for this proposal. Retain provider-independent IDs so a future licensed ExerciseDB.io upgrade can attach exact variant media without resetting workout history.

### Why hosted alternatives are less suitable here

[MuscleWiki's terms](https://api.musclewiki.com/api-terms) limit text caching to 30 days and media to transient playback. Its FAQ acknowledges occasional missing written instructions. An ongoing subscription or negotiated content agreement would be needed. [AscendAPI caching rules](https://docs.ascendapi.com/guides/caching) are plan-dependent and media URLs rotate weekly; persistent storage needs an agreement. [wger's licensing](https://github.com/wger-project/wger#license) must be checked per content/media entry. Its live website returned a bot challenge, so no verified English count is claimed.

## Naming and form requirements

Publish familiar names with explicit variants, such as Barbell back squat, Dumbbell Romanian deadlift and Machine abdominal crunch. Keep historical and colloquial names as aliases. Equipment, grip, incline, support and one-sided variants must remain distinct where they change technique or performance tracking. An unclear name can only be renamed after checking which movement its text and demonstration actually represent.

Picker search should normalize punctuation, singular/plural forms and abbreviations; match names, aliases, primary/secondary muscles and equipment; rank exact names and aliases before broad matches; and expose all matches through pagination. RDL, DB bench, Bulgarian split squat, lat pulldown, pec deck, leg press and spelling variants become acceptance cases. Do not make unrelated exercises aliases merely because they target the same muscle.

Every published entry needs:

1. A one-sentence explanation of what the exercise does, without unexplained anatomy terms.
2. Three to six short numbered steps covering setup, controlled movement, return and safe finish. Add breathing and bracing cues when relevant to the movement/load; distinguish ordinary repetitions from heavy-load bracing rather than prescribing one universal breathing pattern.
3. Two or three concrete form cues and common mistakes. Explain specialist terms in ordinary language. Do not force every user to reach the floor, a fixed depth or a fixed joint angle regardless of control and anatomy.
4. Exact required equipment and variant, including bench, rack, anchor or support where necessary; reviewed difficulty and movement metadata.
5. Source references and dated review by a qualified exercise professional. Review each exercise, not just a random sample; stage publication if the full catalog cannot be reviewed together. Unreviewed or conflicting entries must not be promoted as accepted release content.

Use [ACE's exercise library](https://www.acefitness.org/resources/everyone/exercise-library/) as a professional reference for technique checks, not as an assumed reusable text/media dataset. The [single-leg Romanian deadlift guide](https://www.acefitness.org/resources/everyone/exercise-library/329/single-leg-romanian-deadlift/) emphasizes a hip-driven movement and a comfortable range; the [back-squat guide](https://www.acefitness.org/resources/everyone/exercise-library/11/back-squat/) includes rack setup and body position. Those references inform review; they do not certify all supplier entries. Resolve movement-specific disagreements before publishing. No complete new-library form review is claimed in this research.

## Animation preparation

Proposed vendor-neutral fields for the later contract change:

| Record                | Fields to retain                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity              | Stable Mizyun catalog ID, legacy IDs, source provider, source exercise ID, source snapshot version                                                                            |
| Content               | Familiar name, aliases, variant/equipment, summary, structured instructions, cues, mistakes, references, review status/date/reviewer                                          |
| Demonstration         | Asset ID, exact catalog variant ID, source media ID, kind (`animation`, `video`, `static`), format, resolution, camera view, poster, loop/duration, accessibility description |
| Rights and acceptance | License reference, hosting/offline/edit permissions, attribution, checksum, review status and withdrawn state                                                                 |

Keep an optional demonstration reference on every accepted exercise, initially null or pending; absence of an animation must preserve the text experience. Use stable IDs to connect later media, not names or array positions. Do not invent URLs or imply a static image is a motion animation. Support multiple views per variant and text-only fallback if media is unavailable.

At import, match supplier filenames/IDs to records and retain an asset inventory even while playback is disabled. For each future asset, verify grip, equipment, stance, movement range and return against the reviewed instructions. Prefer controlled repeatable loops with pause/replay, reduced-motion behavior and screen-reader text; load on the detail screen, not all 1,394 assets at startup. Check actual iOS/Android format support and storage/license permissions when implementing playback. Any GIF-to-video conversion must first be permitted by the supplier license.

## Import sequence and acceptance

1. Evaluate and adapt the free RepDB snapshot under the selected zero-cost direction. Pin the source/version/checksum and preserve rights/attribution records. Paid packages are deferred; a future upgrade requires separately selecting and obtaining its licensed content.
2. Produce an import report: raw/unique/accepted/rejected counts, missing fields, duplicate variants, instruction lengths and complete required equipment. Check coverage of common gym, home, cardio and mobility movements and of every currently referenced routine/catalog ID.
3. Build an explicit old-ID to new-ID mapping with exact, ambiguous and unmapped dispositions. Preserve user-owned exercise UUIDs, custom names, saved instructions, sessions, routines, progression history, active recovery and shared routine copies. Archived legacy definitions remain resolvable; ambiguity must not silently merge performance histories.
4. Review content and write the provider-neutral contract/importer, then update local picker/API/Coach consumers together. Keep provider SDKs and remote I/O out of pure core. Adopt an ADR only once the source and storage design are accepted; this report is a proposal.
5. Add regressions at the observed boundaries: empty instructions, aliases/equipment search, >60 results, numbered steps, unknown/replaced legacy ID, restart recovery, variant separation, routine/history integrity and missing media. Verify all existing catalog IDs referenced by generated prescriptions remain resolvable.
6. Format owned files, run focused core/contracts/API/mobile checks and `pnpm check` after concurrent writes settle. Deliver the exact accepted Dev candidate separately; verify search/form readability/large text and saved workout/routine/history/restart journeys on a standalone device. Add animation playback later with independent content and native acceptance.

## Research evidence and current boundary

The coordinator counted the TypeScript catalog initializer with Node, compared the downloaded upstream JSON, and counted the RepDB JSON; a read-only helper independently compared supplier licensing, media and guidance. [Count and hash evidence](evidence/exercise-catalog/audit-2026-10-04.json) records the measured snapshots. Audits contain only public exercise content. No user data or credentials were queried.

Snapshot SHA256 values: free-exercise-db `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`; RepDB Free `b651511287cd7e9261158598bf0263c56c19d2403ad8b57f68426c9c99d17421`. Downloads remain in temporary local files, not republished in the repository. Supplier counts and terms were checked against the dated primary sources linked above. ExerciseDB.io's complete purchased content is unavailable for a full form/count audit.

Current next action: complete qualified per-entry form/variant review and standalone Dev/device acceptance of the local implementation. ExerciseDB.io remains a possible future upgrade. Animation playback and release remain future work.

## Local implementation — 2026-10-04

The approved plan now uses609 local browse entries, compared with the original888 (279 fewer). All888 original definitions remain byte-equivalent in the compatibility archive;62 deliberate same-variant IDs are reused and two explicit lookup aliases connect duplicate historical IDs without rewriting stored IDs. These are609 entries, not609 certified unique movements: pike shoulder press/pike push-up, rear-delt fly/dumbbell reverse fly, and lying dumbbell triceps extension/dumbbell skull crusher remain source candidate duplicate pairs requiring exact-variant review. Swimming and outdoor cycling remain source coverage gaps. Custom user exercises are excluded from these counts.

The pinned importer validates source schema/count/checksum, applies equipment/variant/form corrections, excludes supplier blanket safety tags, and produces descriptions, four-to-six numbered steps, tips, curated mistake text and provenance. All609 carry pending professional review and null demonstrations. No RepDB illustrations, previews, generative derivatives or paid media are imported. Automatic prescriptions retain deliberate equivalent known variants in their original order; new supplier specialties do not enter that pool by alphabetical order.

Fresh search is active-only, normalizes punctuation and ranks canonical names/aliases before muscles/equipment. API pagination and picker Load more reach the complete catalog. Exact saved-ID lookup preserves archived variants. Exact previous labels support reuse of user UUIDs after canonical renaming and existing target/history lookup; ambiguous previous labels remain unresolved rather than combining records. Stored custom text and metadata are preserved. Linked credit appears in Account → Legal → Credits.

[ADR-0040](adr/0040-free-exercise-catalog-and-legacy-identity.md) records the architecture and acceptance limits. Qualified per-entry form/variant acceptance and standalone device search/history/recovery/readability checks remain open before release. ExerciseDB.io is still a future upgrade. Current automated evidence is recorded in status.md and the exercise-catalog evidence directory.
