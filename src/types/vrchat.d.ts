declare module 'vrchat' {
  export class VRChat {
    constructor(options?: any);
    authentication: {
      login(username: string, password: string): Promise<any>;
      verify2FA(code: string, method?: string): Promise<any>;
      verifyAuthToken(): Promise<any>;
      getCurrentUser(): Promise<any>;
    };
    groups: {
      get(groupId: string): Promise<any>;
      getRepresentedGroup(userId: string): Promise<any>;
    };
    users: {
      get(userId: string): Promise<any>;
    };
  }
}
