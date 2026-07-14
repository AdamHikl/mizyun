# Infrastructure adapters

Adapters implement ports owned by domain or application packages. Examples include Supabase repositories, private object storage, job queues, analytics, and health-platform synchronization.

Infrastructure types must not leak into `packages/core`.
