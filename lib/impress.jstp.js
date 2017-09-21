'use strict';

impress.jstp = {};

impress.jstp.mixImpress = true;

impress.jstp.createServer = (
  config // Impress server worker configuration
) => {
  const transportModule =
    config.transport === 'tcp' || config.transport === 'ipc' ?
      'net' :
      config.transport;
  const transport = api.jstp[transportModule];
  if (!transport) {
    return;
  }

  if (config.name === 'master') {
    config.applications = [ impress ];
    config.authPolicy = (
      connection, application, strategy, [nodeId, cloudAccessKey], callback
    ) => {
      impress.cloud.startSession(
        connection, application, nodeId, cloudAccessKey, callback
      );
    };
  } else {
    config.applications = Object.keys(impress.applications)
      .map(key => impress.applications[key]);
    console.dir(impress.applications);
    config.authPolicy = impress.jstp.startSession;
  }

  if (config.transport === 'tls' || config.transport === 'wss') {
    const cert = impress.loadCertificates(config);
    if (!cert) return;
    config = Object.assign({}, config, cert);
  }

  const srv = transport.createServer(config);
  return srv;
};

impress.jstp.mixin = (application) => {
  // JSTP connections
  application.connections = new Map();

  application.callMethod = (
    // Call application method
    connection, // connection instance
    interfaceName, // name of the interface
    methodName, // name of the method
    args, // method arguments (including callback)
    callback
  ) => {
    const appInterface = application.api[interfaceName];
    if (!appInterface) {
      callback(api.jstp.ERR_INTERFACE_NOT_FOUND);
      return;
    }

    let method = appInterface[methodName];
    if (!method) {
      callback(api.jstp.ERR_METHOD_NOT_FOUND);
      return;
    }

    method = method(connection);

    if (method.length !== args.length + 1) {
      callback(api.jstp.ERR_INVALID_SIGNATURE);
      return;
    }

    const startTime = process.hrtime();

    method(...args.concat([onComplete]));

    function onComplete(...args) {
      const executionTime = process.hrtime(startTime);
      const timeMillisec = (executionTime[0] * 1e9 + executionTime[1]) / 1e6;

      const logMessage = (
        interfaceName + '.' + methodName + '\t' +
        timeMillisec + ' ms\t' +
        connection.username + '\t' +
        connection.sessionId + '\t' +
        connection.remoteAddress
      );

      application.log.api(logMessage);
      callback(...args);
    }
  };

  application.getMethods = (
    // Get an array of methods of an interface
    interfaceName // name of the interface to inspect
  ) => {
    const appInterface = application.api[interfaceName];
    if (!appInterface) return null;
    return Object.keys(appInterface);
  };
};

impress.jstp.startSession = (
  // JSTP authentication callback
  connection, // connection instance
  application, // application name
  strategy, // string
  credentials, // array
  callback // function
) => {
  if (strategy !== 'anonymous' || !application.ready) {
    callback(api.jstp.ERR_AUTH_FAILED);
    return;
  }

  const sid = api.common.generateSID(application.config.sessions);
  application.connections.set(sid, connection);

  connection.on('close', () => {
    application.connections.delete(sid);
  });

  callback(null, sid);
};
