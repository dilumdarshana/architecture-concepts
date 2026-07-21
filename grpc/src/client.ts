import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Path to the .proto file — must match what the server uses
const PROTO_PATH = path.join(__dirname, './proto/greeter.proto');

// Load and parse the .proto definition
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// Get the Greeter service client constructor
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter as any;

function main() {
  // Create a client connected to the server at localhost:5050
  const client = new greeterProto.Greeter(
    'localhost:5050',
    grpc.credentials.createInsecure()
  );

  /**
   * Unary RPC — Single request, single response via callback.
   * 
   * client.sayHello({ name: 'TypeScript' }, (error: any, response: any) => {
   *   if (error) {
   *     console.error('Error:', error);
   *     return;
   *   }
   *   console.log('Response:', response.message);
   * });
   */

  /**
   * Server Streaming RPC — Single request, multiple responses via 'data' events.
   * 
   * const call = client.getNumbers({ count: 5 });
   * 
   * call.on('data', (response: any) => {
   *   console.log(`Order: ${response.order} - Number: ${response.number}`);
   * });
   * 
   * call.on('end', () => {
   *   console.log('Stream ended.');
   * });
   * 
   * call.on('error', (error: any) => {
   *   console.error('Error:', error);
   * });
   */

  /**
   * Client Streaming RPC — Multiple requests, single response via callback.
   */
  const stream = client.sumNumbers((error: any, response: any) => {
    if (error) {
      console.error('Error:', error);
      return;
    }
    console.log('Sum:', response.sum);
  });

  [10, 20, 30, 40, 50].forEach((num) => {
    stream.write({ number: num });
  });

  stream.end();
  console.log('Client stream ended.');

  /**
   * Bidirectional Streaming RPC — Both sides send/receive independently.
   * 
   * client.chat() returns a duplex stream: write to send, listen to receive.
   * 
   * const chatStream = client.chat();
   * 
   * chatStream.on('data', (response: any) => {
   *   console.log(`${response.user}: ${response.message}`);
   * });
   * 
   * chatStream.on('end', () => {
   *   console.log('Chat ended.');
   * });
   * 
   * chatStream.on('error', (error: any) => {
   *   console.error('Error:', error);
   * });
   * 
   * ['Hello', 'How are you?', 'Goodbye'].forEach((msg) => {
   *   chatStream.write({ user: 'client', message: msg });
   * });
   * 
   * setTimeout(() => {
   *   chatStream.end();
   * }, 3000);
   */
}

main();
