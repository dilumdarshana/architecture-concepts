import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Path to the Protocol Buffer definition file
const PROTO_PATH = path.join(__dirname, './proto/greeter.proto');

// Load the .proto file into a descriptor that gRPC can use
// The options control how Protobuf types (like int64, enums) are converted to JS
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// Convert the descriptor into a gRPC service object.
// `.greeter` matches `package greeter;` in the .proto file.
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter as any;

/**
 * Unary RPC — Client sends one request, server replies with one response.
 * 
 * `call.request` contains the deserialized HelloRequest message.
 * `callback` sends a HelloReply back to the client.
 *   First argument = error (null if successful),
 *   Second argument = response message.
 */
function sayHello(call: any, callback: any) {
  const reply = { message: `Hello ${call.request.name}!!!` };

  callback(null, reply);
}

/**
 * Server Streaming RPC — Client sends one request, server pushes multiple responses.
 * 
 * Instead of a callback, use `call.write()` to stream data and `call.end()` to finish.
 * The client receives each write as a 'data' event on its stream object.
 */
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

/**
 * Client Streaming RPC — Client sends multiple requests, server responds once.
 * 
 * Listen for 'data' events to accumulate incoming messages.
 * Listen for 'end' to know when the client has finished sending.
 * Use the callback to send the single response back.
 */
function sumNumbers(call: any, callback: any) {
  let sum = 0;

  call.on('data', (request: any) => {
    sum += request.number;
  });

  call.on('end', () => {
    callback(null, { sum });
  });
}

/**
 * Bidirectional Streaming RPC — Both sides send and receive independently.
 * 
 * Use `call.on('data')` to read from the client and `call.write()` to send back.
 * The stream stays open until either side calls `call.end()`.
 */
function chat(call: any) {
  call.on('data', (request: any) => {
    console.log(`Received message from ${request.user}: ${request.message}`);
    const reply = { user: 'server', message: `You said: ${request.message}` };
    call.write(reply);
  });

  call.on('end', () => {
    call.end();
  });
}

/**
 * Create the gRPC server, register all RPC handlers, and bind to a port.
 */
function startServer() {
  const server = new grpc.Server();

  // Map each proto-defined RPC to its implementation function
  server.addService(greeterProto.Greeter.service, {
    sayHello: sayHello,
    getNumbers: getNumbers,
    sumNumbers: sumNumbers,
    chat: chat,
  });

  const address = '0.0.0.0:5050';

  // Bind to the address and start listening
  // Uses insecure credentials (no TLS) — ok for local development
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
