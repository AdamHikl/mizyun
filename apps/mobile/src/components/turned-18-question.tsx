import { ChoiceChip, ChoiceGroup, FormField } from "@/components/ui";
import { TURNED_18_QUESTION, needsTurned18Answer } from "@/lib/adult-age";

/**
 * Asked only when the birth year is the one in which the user may still be
 * 17. The answer is used for this check and never saved.
 */
export function Turned18Question({
  birthYear,
  value,
  onChange,
  currentYear = new Date().getUTCFullYear(),
}: {
  readonly birthYear: string;
  readonly value: boolean | null;
  readonly onChange: (value: boolean) => void;
  readonly currentYear?: number;
}) {
  if (!needsTurned18Answer(birthYear, currentYear)) return null;
  return (
    <FormField label={TURNED_18_QUESTION}>
      <ChoiceGroup>
        <ChoiceChip
          label="Yes"
          selected={value === true}
          onPress={() => onChange(true)}
        />
        <ChoiceChip
          label="Not yet"
          selected={value === false}
          onPress={() => onChange(false)}
        />
      </ChoiceGroup>
    </FormField>
  );
}
