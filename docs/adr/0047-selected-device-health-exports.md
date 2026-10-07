# ADR-0047 — Selected device health exports

Date: 2026-10-06. Status: accepted for Dev source implementation (#219); native/device/privacy exits open.

Adam selected INT-04 outbound exports as stage two before optional INT-03 account synchronization. This changes the implementation sequence, not the earlier preview acceptance or Production gates.

Use separate explicit nutrition/workout write choices each app session, independent of read previews. Write only confirmed first-party newly entered energy/protein/carbohydrate/fat values and freshly marked completed standalone workout start/end intervals. Save Mizyun first. Unknown values remain unknown; zero remains zero. Unknown, imported, community, AI/provider-derived, restored-unknown and date-only historical lineage cannot gain export rights from source=`manual` or confirmation alone. Imported health and own-origin exports never become Coach/statistical/Community/developer evidence.

Keep export mappings/immutable revisions locally in encrypted SecureStore, 40 atomic slots with <=1800-byte payloads. Retain completed stable mappings; capacity exhaustion is explicit, not eviction. Each mapping binds a random client UUID to account/source and a native backup-excluded installation sentinel. Restored grants never dispatch; account changes retire queued native work. Edits/deletion retain up to8 potentially attempted intervals until acknowledged, preserving cleanup after moved timestamps/lost responses. Retry only on explicit foreground action or an eligible new save with a current selected grant. Health failures do not undo successful Mizyun saves.

HealthKit requests only selected share types, no read set, and uses stable per-component sync identifier/version. Acknowledge partial components independently, including removal of null nutrients. Android requests WRITE_NUTRITION/WRITE_EXERCISE independently, uses stable clientRecordId/version and queries only owned origin/exact attempted intervals before owned deletion. Unverifiable/history-limited cleanup remains pending. Native mutation gates survive caller timeout until the underlying OS mutation finishes.

Account deletion purges local mappings across installations without requiring health access or a sentinel. Storage failure is surfaced separately with a local retry; other local cleanup and server deletion are not rolled back. Platform copies remain after stopping exports or deleting Mizyun; explain separate platform management. This is not a promise to erase Apple/Google-held copies.

No server health storage, backend migration, background/history grant, active-energy/weight/advanced nutrient export, routine/import migration, cloud vendor connection, watch app or developer API is part of this initial slice. Production controls remain disabled. Current primary sources and consequences are in the Research Log; complete native app builds and physical write/read-back/restore acceptance remain required.
