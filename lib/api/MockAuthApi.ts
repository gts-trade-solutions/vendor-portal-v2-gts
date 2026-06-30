import type {
  AuthAdapter,
  LoginCredentials,
  RegisterData,
} from "../adapters/AuthAdapter";
import type { User, AuthSession } from "@/types";
import { storage, STORAGE_KEYS, generateId } from "../storage";

const MOCK_USERS = [
  {
    id: "user_admin_001",
    email: "admin@madenkorea.com",
    password: "admin123",
    name: "Admin User",
    role: "admin" as const,
  },
  {
    id: "user_vendor_001",
    email: "vendor@kbeauty.com",
    password: "vendor123",
    name: "Consumer Innovations Direct",
    role: "vendor" as const,
    vendor_id: "vendor_001",
  },
  {
    id: "user_customer_001",
    email: "customer@example.com",
    password: "customer123",
    name: "John Doe",
    role: "customer" as const,
    customer_id: "cust_001",
  },
];

export class MockAuthApi implements AuthAdapter {
  private async delay(ms: number = 500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async login(credentials: LoginCredentials): Promise<AuthSession> {
    await this.delay();

    const user = MOCK_USERS.find(
      (u) =>
        u.email === credentials.email && u.password === credentials.password
    );

    if (!user) {
      throw new Error("Invalid email or password");
    }

    const { password, ...userWithoutPassword } = user;
    const token = `mock_token_${generateId()}`;
    const expires_at = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const session: AuthSession = {
      user: {
        ...userWithoutPassword,
        created_at: new Date().toISOString(),
      },
      token,
      expires_at,
    };

    storage.set(STORAGE_KEYS.AUTH_USER, session.user);
    storage.set(STORAGE_KEYS.AUTH_TOKEN, token);

    return session;
  }

  async register(data: RegisterData): Promise<AuthSession> {
    await this.delay();

    const existingUser = MOCK_USERS.find((u) => u.email === data.email);
    if (existingUser) {
      throw new Error("User already exists with this email");
    }

    const newUser: User = {
      id: generateId("user"),
      email: data.email,
      name: data.name,
      role: data.role || "customer",
      created_at: new Date().toISOString(),
    };

    if (newUser.role === "customer") {
      newUser.customer_id = generateId("cust");
    }

    const token = `mock_token_${generateId()}`;
    const expires_at = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const session: AuthSession = {
      user: newUser,
      token,
      expires_at,
    };

    storage.set(STORAGE_KEYS.AUTH_USER, session.user);
    storage.set(STORAGE_KEYS.AUTH_TOKEN, token);

    return session;
  }

  async logout(): Promise<void> {
    await this.delay(200);
    storage.remove(STORAGE_KEYS.AUTH_USER);
    storage.remove(STORAGE_KEYS.AUTH_TOKEN);
  }

  async getCurrentUser(): Promise<User | null> {
    const user = storage.get<User>(STORAGE_KEYS.AUTH_USER);
    return user;
  }

  async verifyOTP(email: string, otp: string): Promise<AuthSession> {
    await this.delay();

    if (otp === "123456") {
      const user = MOCK_USERS.find((u) => u.email === email);
      if (!user) {
        throw new Error("User not found");
      }

      const { password, ...userWithoutPassword } = user;
      const token = `mock_token_${generateId()}`;
      const expires_at = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const session: AuthSession = {
        user: {
          ...userWithoutPassword,
          created_at: new Date().toISOString(),
        },
        token,
        expires_at,
      };

      storage.set(STORAGE_KEYS.AUTH_USER, session.user);
      storage.set(STORAGE_KEYS.AUTH_TOKEN, token);

      return session;
    }

    throw new Error("Invalid OTP");
  }

  async sendOTP(email: string): Promise<void> {
    await this.delay();
    console.log(`Mock OTP sent to ${email}: 123456`);
  }

  async resetPassword(email: string): Promise<void> {
    await this.delay();
    console.log(`Mock password reset email sent to ${email}`);
  }

  async updatePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await this.delay();
    console.log("Mock password updated");
  }
}

export const mockAuthApi = new MockAuthApi();
