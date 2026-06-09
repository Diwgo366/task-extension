#!/usr/bin/env python3
"""
Native messaging host for Brave Tasks extension.
Reads task data from the extension and writes it to /tmp/brave-tasks.json
for consumption by polybar/waybar/i3blocks.
"""
import sys
import json
import struct
import os

TMP_FILE = '/tmp/brave-tasks.json'

def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        return None
    length = struct.unpack('@I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))

def write_message(msg):
    data = json.dumps(msg).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def main():
    while True:
        msg = read_message()
        if msg is None:
            break

        if msg.get('type') == 'SYNC_TASKS':
            tasks = msg.get('tasks', [])
            pending = [t for t in tasks if not t.get('done')]
            info = {
                'total': len(tasks),
                'pending': len(pending),
                'done': len(tasks) - len(pending),
                'tasks': [{
                    'text': t['text'],
                    'done': t.get('done', False),
                    'dueDate': t.get('dueDate'),
                    'recurrence': t.get('recurrence'),
                    'project': t.get('project'),
                } for t in tasks],
            }
            with open(TMP_FILE, 'w') as f:
                json.dump(info, f)
            os.chmod(TMP_FILE, 0o644)
            write_message({'status': 'ok', 'path': TMP_FILE})

if __name__ == '__main__':
    main()
