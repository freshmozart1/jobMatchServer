import socket

from flask import Flask, request, jsonify
import tiktoken

app = Flask(__name__)

encoders = {}

def find_open_port(host: str = 'localhost', start_port: int = 5001, max_attempts: int = 100) -> int:
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as port_socket:
            try:
                port_socket.bind((host, port))
            except OSError:
                continue

            return port

    end_port = start_port + max_attempts - 1
    raise RuntimeError(f'No open port found on {host} in range {start_port}-{end_port}')


@app.post('/count')
def count_tokens():
    data = request.json

    model = data.get('model', 'gpt-5')
    text = data['text']

    if model not in encoders:
        encoders[model] = tiktoken.encoding_for_model(model)

    encoder = encoders[model]

    return jsonify({'token_count': len(encoder.encode(text))})

def main():
    host = 'localhost'
    port = find_open_port(host=host, start_port=5001)
    token_service_url = f'http://{host}:{port}'
    print(f'TOKEN_SERVICE_URL={token_service_url}', flush=True)
    print(f'Starting token service on {token_service_url}', flush=True)
    app.run(host=host, port=port, use_reloader=False)


if __name__ == '__main__':
    main()