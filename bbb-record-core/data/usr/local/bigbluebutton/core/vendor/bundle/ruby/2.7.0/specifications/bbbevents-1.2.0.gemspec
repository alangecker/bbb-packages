# -*- encoding: utf-8 -*-
# stub: bbbevents 1.2.0 ruby lib

Gem::Specification.new do |s|
  s.name = "bbbevents".freeze
  s.version = "1.2.0"

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.require_paths = ["lib".freeze]
  s.authors = ["Blindside Networks".freeze]
  s.bindir = "exe".freeze
  s.date = "2019-07-19"
  s.description = "Ruby gem for easily parse data from a BigBlueButton recording's events.xml.".freeze
  s.email = ["ffdixon@blindsidenetworks.com".freeze]
  s.homepage = "https://www.blindsidenetworks.com".freeze
  s.licenses = ["LGPL-3.0".freeze]
  s.rubygems_version = "3.1.2".freeze
  s.summary = "Easily parse data from a BigBlueButton recording's events.xml.".freeze

  s.installed_by_version = "3.1.2" if s.respond_to? :installed_by_version

  if s.respond_to? :specification_version then
    s.specification_version = 4
  end

  if s.respond_to? :add_runtime_dependency then
    s.add_development_dependency(%q<bundler>.freeze, ["~> 1.15"])
    s.add_development_dependency(%q<rake>.freeze, ["~> 10.0"])
    s.add_development_dependency(%q<rspec>.freeze, ["~> 3.4"])
    s.add_runtime_dependency(%q<activesupport>.freeze, ["~> 5.0", ">= 5.0.0.1"])
  else
    s.add_dependency(%q<bundler>.freeze, ["~> 1.15"])
    s.add_dependency(%q<rake>.freeze, ["~> 10.0"])
    s.add_dependency(%q<rspec>.freeze, ["~> 3.4"])
    s.add_dependency(%q<activesupport>.freeze, ["~> 5.0", ">= 5.0.0.1"])
  end
end
