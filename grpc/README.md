# gRPC Implementation with Typescript

A simple demonstration of gRPC with TypeScript and pnpm, showcasing four types of RPC calls: unary, server streaming, client streaming and bidirectional.

## Features

- **Unary RPC**: Simple request-response pattern (SayHello)
- **Server Streaming RPC**: Server sends multiple responses (GetNumbers)
- **Client Streaming RPC**: Client sends multiple requests, server responds once (SumNumbers)
- **Bidirectional Streaming RPC**: Real-time chat with simultaneous send/receive (Chat)
- Built with TypeScript for type safety
- Uses pnpm for efficient package management

## Prerequisites

- Node.js
- pnpm (install with `npm install -g pnpm`)

## Installation

1. Clone or download this project
2. Install dependencies:

```bash
pnpm install
```

## Project Structure

```
grpc-typescript-demo/
├── src/
│   ├── proto/
│   │   └── greeter.proto    # Protocol Buffer definition
│   ├── server.ts            # gRPC server implementation
│   └── client.ts            # gRPC client implementation
├── package.json
├── tsconfig.json
└── README.md
```

## Running the Demo

### Start the Server

Open a terminal and run:

```bash
pnpm run server
```

You should see:
```
Server running at http://0.0.0.0:5050
```

### Run the Client

Open another terminal and run:

```bash
pnpm run client
```

## Available RPC Methods

### 1. SayHello (Unary RPC)
Simple request-response pattern.

**Request:**
```typescript
{ name: 'TypeScript' }
```

**Response:**
```typescript
{ message: 'Hello TypeScript!' }
```

### 2. GetNumbers (Server Streaming RPC)
Server sends multiple number responses.

**Request:**
```typescript
{ count: 5 }
```

**Response Stream:**
```typescript
{ order: 1, number: 2 }
{ order: 2, number: 4 }
{ order: 3, number: 6 }
...
```

### 3. SumNumbers (Client Streaming RPC)
Client sends multiple numbers, server returns the sum.

**Request Stream:**
```typescript
{ number: 10 }
{ number: 20 }
{ number: 30 }
...
```

**Response:**
```typescript
{ sum: 150 }
```

### 4. Chat (Bidirectional Streaming RPC)
Real-time bidirectional communication where both client and server can send messages simultaneously.

**Client Sends:**
```typescript
{ user: 'Alice', message: 'Hello!' }
{ user: 'Alice', message: 'How are you?' }
```

**Server Responds:**
```typescript
{ user: 'Server', message: 'Echo: Hello!' }
{ user: 'Server', message: 'Echo: How are you?' }

## Scripts

- `pnpm run server` - Start the gRPC server
- `pnpm run client` - Run the gRPC client
- `pnpm run build` - Compile TypeScript to JavaScript

## Understanding the Code

### Protocol Buffer Definition (greeter.proto)

The `.proto` file defines the service interface and message types:

```protobuf
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc GetNumbers(NumberRequest) returns (stream NumberResponse);
  rpc SumNumbers(stream SumRequest) returns (SumResponse);
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}
```

### Server Implementation

The server implements three RPC methods:
- `sayHello`: Returns a greeting message
- `getNumbers`: Streams a sequence of numbers
- `sumNumbers`: Receives a stream of numbers and returns their sum
- `chat`: Bidirectional streaming for real-time chat communication

### Client Implementation

The client demonstrates how to:
- Make unary calls
- Receive streaming responses
- Send streaming requests

## Customisation

### Change Server Port

In `server.ts`, modify:
```typescript
const address = '0.0.0.0:5050'; // Change port here
```

In `client.ts`, update:
```typescript
const client = new greeterProto.Greeter(
  'localhost:5050', // Match server port
  grpc.credentials.createInsecure()
);
```

### Add New RPC Methods

1. Define the method in `greeter.proto`
2. Implement the method in `server.ts`
3. Call the method from `client.ts`

## Troubleshooting

### Port Already in Use
If you see an error about port 5050 being in use, either:
- Stop the existing process using that port
- Change the port number in both server and client

### Connection Refused
Make sure the server is running before starting the client.

### Proto File Not Found
Ensure the proto file path in both server and client matches your project structure.

## Learn More

- [gRPC Documentation](https://grpc.io/docs/)
- [Protocol Buffers](https://developers.google.com/protocol-buffers)
- [gRPC Node.js Guide](https://grpc.io/docs/languages/node/)

## License

MIT
