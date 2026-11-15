"""Remove the (now invalid) Authenticode signature from a PE file: zero the Security data-directory entry,
zero the checksum, and truncate the certificate blob that sits at the end of the file."""
import struct
import sys

path = sys.argv[1]
data = bytearray(open(path, 'rb').read())
e = struct.unpack_from('<I', data, 0x3C)[0]
assert data[e:e + 4] == b'PE\0\0', 'not a PE file'
opt = e + 24
magic = struct.unpack_from('<H', data, opt)[0]
assert magic == 0x20B, 'expected PE32+'
dd = opt + 112                      # data directories start
sec_off, sec_size = struct.unpack_from('<II', data, dd + 4 * 8)
print(f'security directory: offset={sec_off} size={sec_size} filesize={len(data)}')
if sec_off and sec_size:
    struct.pack_into('<II', data, dd + 4 * 8, 0, 0)
    struct.pack_into('<I', data, opt + 64, 0)   # CheckSum
    if sec_off + sec_size >= len(data) - 8:
        del data[sec_off:]
        print('truncated certificate blob; new size', len(data))
    else:
        print('certificate not at end of file; entry zeroed only')
    open(path, 'wb').write(data)
    print('signature stripped')
else:
    print('no signature present')
