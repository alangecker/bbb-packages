OPTS="--vendor BigBlueButon -m ffdixon@bigbluebutton.org --url http://bigbluebutton.org/"

if [ -f /etc/lsb-release ]; then
  find /var/lib/gems/ -name deb.rb | grep '/fpm.*/lib/fpm/package/deb.rb' | xargs -I{} sed -i 's/if attributes\[:deb_use_file_permissions/if !attributes\[:deb_use_file_permissions/g' {}
fi
 
