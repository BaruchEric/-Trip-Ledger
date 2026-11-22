function readEnv(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const GOOGLE_MAPS_API_KEY = readEnv(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

export interface FirebaseEnvOverrides {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}

export function getFirebaseEnvOverrides(): FirebaseEnvOverrides {
  const overrides: FirebaseEnvOverrides = {};

  const apiKey = readEnv(import.meta.env.VITE_FIREBASE_API_KEY);
  const authDomain = readEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = readEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const storageBucket = readEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET);
  const messagingSenderId = readEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID);
  const appId = readEnv(import.meta.env.VITE_FIREBASE_APP_ID);
  const measurementId = readEnv(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);
  const firestoreDatabaseId = readEnv(import.meta.env.VITE_FIREBASE_DATABASE_ID);

  if (apiKey) overrides.apiKey = apiKey;
  if (authDomain) overrides.authDomain = authDomain;
  if (projectId) overrides.projectId = projectId;
  if (storageBucket) overrides.storageBucket = storageBucket;
  if (messagingSenderId) overrides.messagingSenderId = messagingSenderId;
  if (appId) overrides.appId = appId;
  if (measurementId) overrides.measurementId = measurementId;
  if (firestoreDatabaseId) overrides.firestoreDatabaseId = firestoreDatabaseId;

  return overrides;
}
