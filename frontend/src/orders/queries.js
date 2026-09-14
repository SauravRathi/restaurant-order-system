// Order reads and writes, and the cache rules that go with them.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api/client.js';

// Cache keys in one place. Every key starts with 'orders', which is what makes
// `invalidateQueries({ queryKey: ['orders'] })` mean "every order view is now suspect" in a
// single call — lists, details and timelines together.
export const orderKeys = {
  all: ['orders'],
  lists: ['orders', 'list'],
  list: (filters) => ['orders', 'list', filters],
  detail: (id) => ['orders', 'detail', id],
  timeline: (id) => ['orders', 'timeline', id],
};

export function useOrders(filters) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: ({ signal }) => get('/orders', filters, { signal }),

    // Paging and filtering keep the previous page on screen while the next one loads, instead
    // of collapsing to a spinner and back. The table does not jump, and the pager buttons stay
    // where the cursor already is.
    placeholderData: keepPreviousData,
  });
}

/** §2. The one write that has no order to update yet — it creates one. */
export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tableNumber) => post('/orders', { tableNumber }).then((r) => r.order),
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Everyone, for the waiter filter and the collaborator picker. */
export const useUsers = (role) =>
  useQuery({
    queryKey: ['users', role ?? 'all'],
    queryFn: () => get('/users', { role }).then((r) => r.users),

    // Staff lists change when someone is hired, not while the board is open.
    staleTime: 5 * 60_000,
  });

