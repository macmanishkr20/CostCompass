import { Injectable, signal, computed } from '@angular/core';

const STORAGE_KEY = 'costcompass_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Current authenticated user email */
  readonly currentUser = signal<string | null>(this.loadFromStorage());

  /** Whether a user is currently logged in */
  readonly isAuthenticated = computed(() => !!this.currentUser());

  /** Display name derived from email */
  readonly displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return '';
    return user
      .split('@')[0]
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  });

  /** User initials for avatar */
  readonly initials = computed(() => {
    const name = this.displayName();
    if (!name) return '';
    const parts = name.split(' ');
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  });

  login(email: string): boolean {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@') || trimmed.length < 5) {
      return false;
    }
    this.currentUser.set(trimmed);
    localStorage.setItem(STORAGE_KEY, trimmed);
    return true;
  }

  logout(): void {
    this.currentUser.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  private loadFromStorage(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
