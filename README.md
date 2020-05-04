# BigBlueButton Debian Packages
tracks changes of the closed source debian packages.

## Background
Currently there are quite of lot of configuration files and scripts served within the ubuntu/debian packages, which aren't locatable in any public place. The only way to retrieve them is manually via the debian repository without any possibility to track changes and even less contribute to it, why I consider it as closed source.

This script extracts the packages into this git repository so we can at least catch up on what's going on in there.

My personal reason for starting this is that I was quite annoyed after my instance broke and I couldn't find any potentially causal change in the git history until I finally found out that they changed a configuration in the debian package without checking it into git.

## Limitations
- To keep the repository from getting too big, most of the binary files are removed (see `--exclude` statements in `scrape.py`). You can therefore not directly recreate packages based on this repo.
- Since the version numbers in the debian repository are wrong, you need to manually compare [release](https://github.com/bigbluebutton/bigbluebutton/releases) and commit times to find out to which version a change belongs.

## Related Issues
- [#8978](https://github.com/bigbluebutton/bigbluebutton/issues/8978) Open development of Debian package spec
- [#9290](https://github.com/bigbluebutton/bigbluebutton/issues/9290) Availability of deb-packages with previous versions
- [#9042](https://github.com/bigbluebutton/bigbluebutton/pull/9042) add missing bbb-restart-kms script which was added to 2.2.3 but is missing in the repo
- [#9048](https://github.com/bigbluebutton/bigbluebutton/issues/9048) Missing source for cron.hourly kurento restart task introduced in 2.2.3

## License
unclear... most files are licensed as LGPL-3.0 in the [official repo](https://github.com/bigbluebutton/bigbluebutton), but some got never release under any license and must be therefore considered as proprietary. 
