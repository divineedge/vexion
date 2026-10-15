/** Manual DTO helpers for expense categories including soft-deleted ones (until codegen adds hooks). */
import { customFetch, getListExpenseCategoriesQueryKey } from '@workspace/api-client-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface ExpenseCategoryWithDeleted { key: string; name: string; deletedAt?: string | null }
export const ALL_CATEGORIES_KEY = ['expense-categories', 'include-deleted'] as const;

/** Every category ever used, for labelling history. Filter `!deletedAt` for new selections. */
export function useAllExpenseCategories() {
  return useQuery({
    queryKey: ALL_CATEGORIES_KEY,
    queryFn: () => customFetch<ExpenseCategoryWithDeleted[]>('/api/expense-categories?includeDeleted=true'),
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => customFetch<void>(`/api/expense-categories/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
      qc.invalidateQueries({ queryKey: ALL_CATEGORIES_KEY });
      qc.invalidateQueries({ predicate: q => JSON.stringify(q.queryKey).includes('/api/vendors') });
    },
  });
}
