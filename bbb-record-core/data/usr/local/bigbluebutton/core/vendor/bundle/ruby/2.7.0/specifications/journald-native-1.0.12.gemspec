# -*- encoding: utf-8 -*-
# stub: journald-native 1.0.12 ruby lib
# stub: ext/journald_native/extconf.rb

Gem::Specification.new do |s|
  s.name = "journald-native".freeze
  s.version = "1.0.12"

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.require_paths = ["lib".freeze]
  s.authors = ["Anton Smirnov".freeze]
  s.date = "2020-05-25"
  s.email = ["sandfox@sandfox.me".freeze]
  s.extensions = ["ext/journald_native/extconf.rb".freeze]
  s.files = ["ext/journald_native/extconf.rb".freeze]
  s.homepage = "https://github.com/theforeman/journald-native".freeze
  s.licenses = ["LGPL-2.1+".freeze]
  s.required_ruby_version = Gem::Requirement.new(">= 1.9.3".freeze)
  s.requirements = ["systemd-journal".freeze, "systemd development package".freeze]
  s.rubygems_version = "3.1.2".freeze
  s.summary = "systemd-journal logging native lib wrapper".freeze

  s.installed_by_version = "3.1.2" if s.respond_to? :installed_by_version

  if s.respond_to? :specification_version then
    s.specification_version = 4
  end

  if s.respond_to? :add_runtime_dependency then
    s.add_development_dependency(%q<bundler>.freeze, [">= 1.6", "< 3"])
    s.add_development_dependency(%q<rake>.freeze, [">= 0"])
    s.add_development_dependency(%q<rake-compiler>.freeze, [">= 0"])
    s.add_development_dependency(%q<rspec>.freeze, ["~> 3.4"])
  else
    s.add_dependency(%q<bundler>.freeze, [">= 1.6", "< 3"])
    s.add_dependency(%q<rake>.freeze, [">= 0"])
    s.add_dependency(%q<rake-compiler>.freeze, [">= 0"])
    s.add_dependency(%q<rspec>.freeze, ["~> 3.4"])
  end
end
