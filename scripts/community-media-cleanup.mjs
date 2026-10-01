/** Drain bounded durable byte-deletion tickets. Never sign a download URL. */
export function createCommunityMediaCleaner({
  rpc,
  url,
  key,
  fetchImpl = fetch,
}) {
  const root = new URL(url);
  if (
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    !["https:", "http:"].includes(root.protocol)
  )
    throw new Error("Invalid cleanup target");
  return async () => {
    const jobs = await rpc("community_media_cleanup", {
      p_operation: "claim",
      p_args: { limit: 50 },
    });
    if (!Array.isArray(jobs) || jobs.length > 50)
      throw new Error("Invalid media cleanup batch");
    let cleaned = 0;
    for (const job of jobs) {
      if (
        !/^[0-9a-f-]{36}$/.test(job.id) ||
        job.imagePath !== `quarantine/${job.id}/image.jpg` ||
        job.thumbnailPath !== `quarantine/${job.id}/thumbnail.jpg`
      )
        throw new Error("Invalid media cleanup path");
      const response = await fetchImpl(
        new URL("/storage/v1/object/community-media", root),
        {
          method: "DELETE",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prefixes: [job.imagePath, job.thumbnailPath],
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw new Error("Media Storage cleanup unavailable");
      await rpc("community_media_cleanup", {
        p_operation: "ack",
        p_args: { id: job.id },
      });
      cleaned++;
    }
    return cleaned;
  };
}
