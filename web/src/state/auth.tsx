import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

/**
 * État d'authentification.
 *
 * La session vit dans un cookie httpOnly : le front ne détient aucun jeton et
 * se contente d'interroger `/api/auth/me`. Un 401 signifie simplement
 * « non connecté » et n'est donc pas traité comme une erreur.
 */

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        const { user } = await api.auth.me();
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthenticated) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const setUser = useCallback(
    (user: User | null) => queryClient.setQueryData(['auth', 'me'], user),
    [queryClient],
  );

  const loginMutation = useMutation({
    mutationFn: api.auth.login,
    onSuccess: ({ user }) => setUser(user),
  });

  const registerMutation = useMutation({
    mutationFn: api.auth.register,
    onSuccess: ({ user }) => setUser(user),
  });

  const logoutMutation = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      setUser(null);
      // Les données d'un compte ne doivent pas rester en cache après déconnexion.
      queryClient.clear();
    },
  });

  const value = useMemo<AuthState>(
    () => ({
      user: data ?? null,
      isLoading,
      isAdmin: data?.role === 'ADMIN',
      login: async (input) => {
        await loginMutation.mutateAsync(input);
      },
      register: async (input) => {
        await registerMutation.mutateAsync(input);
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
    }),
    [data, isLoading, loginMutation, registerMutation, logoutMutation, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un <AuthProvider>');
  return context;
}
