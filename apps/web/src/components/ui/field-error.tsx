interface FieldErrorProps {
  touched?: boolean;
  error?: string;
}

// Per-field replacement for the single `{error && <p className="text-xs
// text-destructive">{error}</p>}` pattern this app used to copy-paste once
// per form -- same visual language, just keyed to one field's touched/error
// pair instead of one summary string. Never used for post-submit/server-
// outcome errors -- those stay on useToast()/local state, untouched.
export function FieldError({ touched, error }: FieldErrorProps) {
  if (!touched || !error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}
