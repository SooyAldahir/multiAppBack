require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env`);
  }
  return value;
}

const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME || 'multiApp',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  // IA del recetario (formato compatible con OpenAI). Por defecto: Groq (nivel gratuito).
  ai: {
    baseUrl: (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || process.env.GROQ_API_KEY || '',
    model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    // Modelo que entiende imágenes (para calcular calorías con una foto).
    visionModel: process.env.AI_VISION_MODEL || 'qwen/qwen3.8-27b',
  },
  // Fotos de perfil (Cloudinary, plan gratuito en cloudinary.com)
  cloudinary: parseCloudinary(),
  // Notificaciones push (Firebase Cloud Messaging). Opcional.
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT || '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  },
  // Mapas con OpenStreetMap (gratis, sin clave).
  geo: {
    nominatimUrl: (process.env.GEO_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
    overpassUrl: process.env.GEO_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
    countryCodes: process.env.GEO_COUNTRY_CODES ?? 'mx',
    contactEmail: process.env.GEO_CONTACT_EMAIL || '',
  },
};

/** Acepta CLOUDINARY_URL=cloudinary://key:secret@cloud o las tres variables por separado. */
function parseCloudinary() {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3], folder: process.env.CLOUDINARY_FOLDER || 'multiapp' };
  }
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'multiapp',
  };
}

function assertEnv() {
  required('JWT_SECRET');
  required('DB_PASSWORD');
  if (env.nodeEnv === 'production') {
    if (env.jwt.secret.length < 32) {
      throw new Error('En producción JWT_SECRET debe tener al menos 32 caracteres aleatorios');
    }
    if (env.db.server !== 'localhost' && !env.db.encrypt) {
      console.warn('⚠ DB_ENCRYPT=false: en Azure SQL debe ser true');
    }
  }
}

module.exports = { env, assertEnv };
