export const spokenRunPace = (pace: string | null): string =>
  pace
    ? `Average pace, ${pace.replace(":", " minutes ").replace(" /km", " seconds per kilometre").replace(" /mi", " seconds per mile")}`
    : "Average pace unavailable without distance";
