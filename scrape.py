import subprocess
import os
import re
from tempfile import mkdtemp

repo = "http://ubuntu.bigbluebutton.org/bionic-230-dev/"

directory = '.'
existingPkg = os.listdir('deb')


res = subprocess.check_output(['curl', '-s', repo+"/dists/bigbluebutton-bionic/main/binary-amd64/Packages"])
for pkg in res.decode('utf-8').split('\n\n'):
    if "Package: bbb-" not in pkg:
        continue

    name = re.search(r'Package: (.*)', pkg)[1]
    version = re.search(r'Version: (.*)', pkg)[1]
    path = re.search(r'Filename: (.*)', pkg)[1]
    filename = path.split('/')[-1]
    print("processing "+name+"...")
    
    if filename in existingPkg:
        print(" - skipping (already extracted)")
        # this package was already processed
        continue

    print({
        'name': name,
        'version': version,
        'path': path,
        'filename': filename
    })
    subprocess.run(['wget',  '-O', 'deb/'+filename, repo+"/"+path])

    tmpdir = mkdtemp()

    # extract .deb
    subprocess.run(['ar',  'x', '--output', tmpdir, 'deb/'+filename])

    # remove existing files
    subprocess.run(['rm',  '-rf', directory+'/'+name])

    # extract control
    subprocess.run(['mkdir', '-p', directory+'/'+name+'/control'])
    subprocess.run([
        'tar', 
        'xfv', 
        tmpdir+'/control.tar.gz' if os.path.isfile(tmpdir+'/control.tar.gz') else tmpdir+'/control.tar',
        '-C', directory+'/'+name+'/control',
    ])

    # extract data
    subprocess.run(['mkdir', '-p', directory+'/'+name+'/data'])

    
    subprocess.run([
        'tar', 
        'xfv', 
        tmpdir+'/data.tar.gz' if os.path.isfile(tmpdir+'/data.tar.gz') else tmpdir+'/data.tar', 
        '-C', directory+'/'+name+'/data',
        # '--exclude', '*.jar',
        '--exclude', '*.class',
        '--exclude', '*.gz',
        '--exclude', '*.swf',
        '--exclude', '*.cache',
        '--exclude', '*.wav',
        '--exclude', '*.so',
        '--exclude', '*.so.*',
        '--exclude', '*.la',
        '--exclude', '*.a',
        '--exclude', 'node_modules',
        '--exclude', 'test_image.jpg'
    ])

    # git commit
    subprocess.run(['git', 'add', directory+'/'+name])
    subprocess.run(['git', 'commit', '-m', name+': '+version])

print("done")
