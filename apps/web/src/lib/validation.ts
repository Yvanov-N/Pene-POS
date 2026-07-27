import * as Yup from "yup";

export const PIN_LENGTH = 4;
export const PIN_PATTERN = /^\d{4}$/;
export const MIN_PASSWORD_LENGTH = 6;

// A required 4-digit numeric PIN. One message covers both "required" and
// "wrong format" -- every existing PIN field already collapses those into
// one message (resetPin.invalid, admin.profile.pinInvalid).
export function pinSchema(message: string) {
  return Yup.string().required(message).matches(PIN_PATTERN, message);
}

// A "confirm PIN" field that must equal pinFieldName's value.
export function pinConfirmationSchema(pinFieldName: string, message: string) {
  return Yup.string()
    .required(message)
    .oneOf([Yup.ref(pinFieldName)], message);
}

// A required password of at least MIN_PASSWORD_LENGTH characters. One
// message covers both cases (an empty string already fails the length
// check, so nothing needs distinct wording).
export function passwordSchema(message: string) {
  return Yup.string().required(message).min(MIN_PASSWORD_LENGTH, message);
}

// A "confirm password" field that must equal passwordFieldName's value.
export function passwordConfirmationSchema(passwordFieldName: string, message: string) {
  return Yup.string()
    .required(message)
    .oneOf([Yup.ref(passwordFieldName)], message);
}

interface NumberSchemaOptions {
  integer?: boolean; // whole numbers only (stock, restocking quantity)
  min?: number; // inclusive lower bound (price/stock >= 0)
  moreThan?: number; // exclusive lower bound (recharge/withdraw > 0)
}

// A required, finite number typed into a text/number input. Formik keeps the
// field's own value as a string; Yup casts it for validation only -- onSubmit
// still does its own Number(values.x) when building the record to persist,
// exactly as before. One message is reused for every failing case, matching
// each field's single existing error message (no form in this app
// distinguishes "required" from "not a number" from "too small").
export function numberSchema(message: string, options: NumberSchemaOptions = {}) {
  let schema = Yup.number().typeError(message).required(message);
  if (options.integer) schema = schema.integer(message);
  if (options.min !== undefined) schema = schema.min(options.min, message);
  if (options.moreThan !== undefined) schema = schema.moreThan(options.moreThan, message);
  return schema;
}

// Shared shape of the "is this value already used by a different row" check
// every async uniqueness .test() follows (barcode, category name, badge
// code) -- the actual db.<table>.where(...) query differs per field/table
// and stays inline in each form's schema.
export function notTakenByOther(existing: { id: string } | undefined, currentId: string | undefined): boolean {
  return !existing || existing.id === currentId;
}
