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

function main() {
  const client = new greeterProto.Greeter(
    'localhost:5050',
    grpc.credentials.createInsecure()
  );

  // Simple unary call
  // client.sayHello({ name: 'TypeScript' }, (error: any, response: any) => {
  //   if (error) {
  //     console.error('Error:', error);
  //     return;
  //   }
  //   console.log('Response:', response.message);
  // });

  // Streaming call
  // const call = client.getNumbers({ count: 5 });

  // call.on('data', (response: any) => {
  //   console.log(`Order: ${response.order} - Number: ${response.number}`);
  // });

  // call.on('end', () => {
  //   console.log('Stream ended.');
  // });

  // call.on('error', (error: any) => {
  //   console.error('Error:', error);
  // });

  // Client streaming call
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
}

main();
