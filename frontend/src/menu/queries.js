// Menu reads and writes (§1, §7).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../api/client.js';

export const menuKeys = {
  all: ['menu'],
  list: (includeArchived) => ['menu', 'list', Boolean(includeArchived)],
};

/**
 * The menu. `includeArchived` is ignored by the server for a waiter rather than refused, which
 * is what lets one component serve both roles without knowing the rule first.
 */
export const useMenuItems = (includeArchived = false) =>
  useQuery({
    queryKey: menuKeys.list(includeArchived),
    queryFn: () => get('/menu-items', { includeArchived: String(includeArchived) }).then((r) => r.menuItems),

    // A menu changes when a manager changes it, which is a mutation this app makes and
    // invalidates. It does not go stale on its own while someone reads it.
    staleTime: 60_000,
  });

/**
 * Every menu write invalidates every menu list. Both the archived and unarchived caches, since
 * archiving moves an item between them and patching a price changes it in both.
 */
function useMenuMutation(mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: menuKeys.all }),
  });
}

export const useCreateMenuItem = () => useMenuMutation((item) => post('/menu-items', item));

export const useUpdateMenuItem = () =>
  useMenuMutation(({ id, ...fields }) => patch(`/menu-items/${id}`, fields));

// Archive and restore are one hook: the same shape, and which one it is is a parameter.
export const useArchiveMenuItem = () =>
  useMenuMutation(({ id, restore }) => post(`/menu-items/${id}/${restore ? 'restore' : 'archive'}`));

// §7's bulk requests are not here.
//
// One Apply in the editor can mean several calls — the queue is folded into one intention per
// item and then grouped, so the number of requests depends on how many distinct payloads come
// out of it. A mutation hook models one call, so bulkQueue.js issues them directly and does the
// cache invalidation itself.
