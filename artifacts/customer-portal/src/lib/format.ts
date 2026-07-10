import { format } from "date-fns";

export function formatCurrency(amount: number | undefined | null) {
  if (amount === undefined || amount === null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(dateString: string | undefined | null) {
  if (!dateString) return "";
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}

export function formatDateTime(dateString: string | undefined | null) {
  if (!dateString) return "";
  try {
    return format(new Date(dateString), "MMM d, yyyy h:mm a");
  } catch (e) {
    return dateString;
  }
}
