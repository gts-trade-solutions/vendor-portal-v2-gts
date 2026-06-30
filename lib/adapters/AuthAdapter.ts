import type { User, AuthSession, UserRole } from '@/types';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface AuthAdapter {
  login(credentials: LoginCredentials): Promise<AuthSession>;

  register(data: RegisterData): Promise<AuthSession>;

  logout(): Promise<void>;

  getCurrentUser(): Promise<User | null>;

  verifyOTP(email: string, otp: string): Promise<AuthSession>;

  sendOTP(email: string): Promise<void>;

  resetPassword(email: string): Promise<void>;

  updatePassword(currentPassword: string, newPassword: string): Promise<void>;
}
