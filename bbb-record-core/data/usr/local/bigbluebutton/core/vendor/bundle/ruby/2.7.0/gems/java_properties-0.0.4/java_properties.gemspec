Gem::Specification.new do |s|
  s.name = "java_properties"
  s.version = "0.0.4"
  s.date = "2008-06-14"
  s.summary = "Simple gem for reading/writing Java properties files from Ruby."
  s.email = "flergl@flergl.net"
  s.homepage = "http://github.com/flergl/java-properties-for-ruby"
  s.description = "A class that can read and write to Java properties files that behaves
otherwise as a standard ruby Enumerable. The keys to this object can
be provided as Strings or Symbols, but internally they are Symbols."
  s.has_rdoc = true
  s.authors = ["Dwayne Kristjanson"]
  s.files = ["History.txt", "Manifest.txt", "README.txt", "Rakefile","java_properties.gemspec",
             "lib/java_properties.rb","lib/java_properties/delimiters.rb",
             "lib/java_properties/encoding.rb","lib/java_properties/parser.rb",
             "lib/java_properties/properties-files.rb","lib/java_properties/specialchars.rb",
             "lib/java_properties/utf8.rb","lib/java_properties/version.rb","bin/properties2yaml",
             "test/test_data.rb","test/test_helper.rb","test/test_java_properties.rb"]
  s.test_files = ["test/test_data.rb","test/test_helper.rb","test/test_java_properties.rb"]
  s.rdoc_options = ["--main", "README.txt"]
  s.extra_rdoc_files = ["History.txt", "Manifest.txt", "README.txt"]
  s.executables = ["properties2yaml"]
end
