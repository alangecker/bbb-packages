# -*- encoding: utf-8 -*-
# stub: java_properties 0.0.4 ruby lib

Gem::Specification.new do |s|
  s.name = "java_properties".freeze
  s.version = "0.0.4"

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.require_paths = ["lib".freeze]
  s.authors = ["Dwayne Kristjanson".freeze]
  s.date = "2008-06-13"
  s.description = "A class that can read and write to Java properties files that behaves\notherwise as a standard ruby Enumerable. The keys to this object can\nbe provided as Strings or Symbols, but internally they are Symbols.".freeze
  s.email = "flergl@flergl.net".freeze
  s.executables = ["properties2yaml".freeze]
  s.extra_rdoc_files = ["History.txt".freeze, "Manifest.txt".freeze, "README.txt".freeze]
  s.files = ["History.txt".freeze, "Manifest.txt".freeze, "README.txt".freeze, "bin/properties2yaml".freeze]
  s.homepage = "http://github.com/flergl/java-properties-for-ruby".freeze
  s.rdoc_options = ["--main".freeze, "README.txt".freeze]
  s.rubygems_version = "3.1.2".freeze
  s.summary = "Simple gem for reading/writing Java properties files from Ruby.".freeze

  s.installed_by_version = "3.1.2" if s.respond_to? :installed_by_version
end
