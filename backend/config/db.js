const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

/**
 * Turns a driver connection failure into a short, actionable message. Mongoose's ServerSelectionError
 * carries a huge topology object; the useful parts are the top-level message and each server's error.
 */
function describeConnectionError(err) {
  const lines = [`${err.name}: ${err.message}`];
  const servers = err.reason && err.reason.servers;
  if (servers && typeof servers.forEach === 'function') {
    servers.forEach((server, address) => {
      lines.push(`  - ${address}: ${server.error ? server.error.message : server.type}`);
    });
  }
  if (/ServerSelection/.test(err.name)) {
    lines.push(
      'Hints: the cluster was found but no server accepted a connection. Check that Atlas Network Access has an ACTIVE',
      '0.0.0.0/0 entry in the SAME project as this cluster (not temporary/expired), and that the cluster is not paused.'
    );
  } else if (/auth/i.test(err.message)) {
    lines.push('Hints: check the database user name/password in MONGO_URI (URL-encode special characters such as @ : / #).');
  } else if (/querySrv|ENOTFOUND|EBADNAME/i.test(err.message)) {
    lines.push('Hints: the cluster host name in MONGO_URI is wrong. Copy the connection string again from Atlas → Connect → Drivers.');
  }
  return lines.join('\n');
}

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

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 20,
      autoIndex: true,
    });
  } catch (err) {
    err.message = describeConnectionError(err);
    err.isDbConnectionError = true;
    throw err;
  }

  // Make sure unique indexes (e.g. one bid per vendor per RFQ) exist before traffic arrives.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
