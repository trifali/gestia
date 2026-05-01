import type { GetAppConfig } from 'wasp/server/operations';

type AppConfig = {
  signupDisabled: boolean;
};

export const getAppConfig: GetAppConfig<void, AppConfig> = async () => {
  return {
    signupDisabled: process.env.DISABLE_SIGNUP === 'true',
  };
};
