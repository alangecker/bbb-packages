import subprocess
import os
import re
from tempfile import mkdtemp

repo = "http://ubuntu.bigbluebutton.org/xenial-22/"

directory = '.'
existingPkg = os.listdir('deb')


tmpdir = mkdtemp()
print(tmpdir)

res = subprocess.check_output(['curl', '-s', repo+"/dists/bigbluebutton-xenial/main/binary-amd64/Packages"])
for pkg in res.decode('utf-8').split('\n\n'):
    if "Package: bbb-" not in pkg:
        continue

    name = re.search(r'Package: (.*)', pkg)[1]
    version = re.search(r'Version: (.*)', pkg)[1]
    path = re.search(r'Filename: (.*)', pkg)[1]
    filename = path.split('/')[-1]
    
    # if filename in existingPkg:
    #     # this package was already processed
    #     continue

    print({
        'name': name,
        'version': version,
        'path': path,
        'filename': filename
    })
    subprocess.run(['wget',  '-O', 'deb/'+filename, repo+"/"+path])

    # remove old files
    subprocess.run(['rm',  '-rf', tmpdir+'/*'])

    # extract .deb
    subprocess.run(['ar',  'x', '--output', tmpdir, 'deb/'+filename])

    # remove existing files
    subprocess.run(['rm',  '-rf', directory+'/'+name])

    # extract control
    subprocess.run(['mkdir', '-p', directory+'/'+name+'/control'])
    subprocess.run([
        'tar', 
        'xfv', 
        tmpdir+'/control.tar.gz', 
        '-C', directory+'/'+name+'/control',
    ])

    # extract data
    subprocess.run(['mkdir', '-p', directory+'/'+name+'/data'])
    subprocess.run([
        'tar', 
        'xfv', 
        tmpdir+'/data.tar.gz', 
        '-C', directory+'/'+name+'/data',
        '--exclude', '*.jar',
        '--exclude', '*.class',
        '--exclude', '*.gz',
        '--exclude', '*.swf',
        '--exclude', '*.cache',
        '--exclude', '*.wav',
        '--exclude', '*.so',
        '--exclude', '*.so.*',
        '--exclude', '*.la',
        '--exclude', '*.a',
        '--exclude', '*.ttf',
        '--exclude', '*.woff',
        '--exclude', 'node_modules',
        '--exclude', 'test_image.jpg'
    ])

    # git commit
    subprocess.run(['git', 'add', directory+'/'+name])
    subprocess.run(['git', 'commit', '-m', name+': '+version])

