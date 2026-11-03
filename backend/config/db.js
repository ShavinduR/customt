const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectDB(uri) {
  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log(`[db] MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  });
  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[db] MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[db] MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    autoIndex: true,
  });

  // Make sure unique indexes (e.g. one bid per vendor per RFQ) exist before traffic arrives.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
