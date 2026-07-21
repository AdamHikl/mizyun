export const lengthUnitLabel = (
  unitSystem: "metric" | "imperial",
): "cm" | "in" => (unitSystem === "imperial" ? "in" : "cm");

export const displayLengthToCentimeters = (
  value: number,
  unitSystem: "metric" | "imperial",
): number => {
  const centimeters = unitSystem === "imperial" ? value * 2.54 : value;
  return Math.round(centimeters * 100) / 100;
};

export const centimetersToDisplayLength = (
  centimeters: number,
  unitSystem: "metric" | "imperial",
): number => {
  const display = unitSystem === "imperial" ? centimeters / 2.54 : centimeters;
  return Math.round(display * 100) / 100;
};
