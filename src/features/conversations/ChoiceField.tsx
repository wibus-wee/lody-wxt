import { Field } from '../../shared/ui/field';
import { Select } from '../../shared/ui/select';

export function ChoiceField({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field.Root disabled={disabled}>
      <Field.Label>{label}</Field.Label>
      <Select.Root
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <Select.Trigger aria-label={label}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {choices.map((choice) => (
            <Select.Item key={choice.value} value={choice.value}>
              {choice.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}
