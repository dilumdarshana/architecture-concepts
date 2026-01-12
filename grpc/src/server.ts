import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.join(__dirname, './proto/greeter.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter as any;

// Implement the SayHello RPC method
function sayHello(call: any, callback: any) {
  const reply = { message: `Hello ${call.request.name}!!!` };

  callback(null, reply);
}

// Implement the SayHelloStream RPC method
function getNumbers(call: any) {
  const count = call.request.count || 10;
  let current = 1;

  const intervalId = setInterval(() => {
    if (current > count) {
      clearInterval(intervalId);
      call.end();
      return;
    }
    call.write({ order: current, number: current * 100 });
    current++;
  }, 1000);
}

// Implement client stream RPC method
function sumNumbers(call: any, callback: any) {
  let sum = 0;

  call.on('data', (request: any) => {
    sum += request.number;
  });

  call.on('end', () => {
    callback(null, { sum });
  });
}

// Create and start the server
function startServer() {
  const server = new grpc.Server();

  server.addService(greeterProto.Greeter.service, {
    sayHello: sayHello,
    getNumbers: getNumbers,
    sumNumbers: sumNumbers,
  });

  const address = '0.0.0.0:5050';

  server.bindAsync(
    address,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error('Server binding failed:', error);
        return;
      }
      console.log(`Server running at http://0.0.0.0:${port}`);
    }
  );
}

startServer();
