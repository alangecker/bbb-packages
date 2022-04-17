require "java_properties/encoding"

module JavaProperties
  
  # Module for parsing Java properties text into a Hash.
  #
  #    props_hash = JavaProperties::Parser.parse( string_of_propfile_contents )
  
  module Parser
    
    # Parses a string containing the contents of a Java properties
    # file into a hash of key/value pairs. The keys are converted
    # into symbols.
    
    def self.parse text
      props = {}
      text = self.normalize(text)
      text.split(/[\n\r]+/).each do |line|
	if line =~ /^([^=]*)=(.*)$/ then
	  key,value = $1,$2
	elsif line =~ /\S/ then
	  key,value = line, ''
	else
	  key,value = nil,nil
	end
	props[Encoding.decode(key).to_sym] = Encoding.decode(value) unless key.nil? && value.nil?
      end
      props
    end
     
    # Normalizes the contents of a Java properties file so
    # that comments are removed, leading spaces are trimmed off,
    # multiline entries are consolidated and all delimiters
    # are consistent.
  
    def self.normalize text
      # Remove comment lines
      text.gsub!( /^\s*[!\#].*$/, '' )
      # Remove all leading spaces
      text.gsub!( /^\s+/, '' )
      # Remove all trailing spaces
      text.gsub!( /\s+$/, '' )
      # Concatenate strings ending with \
      text.gsub!( /\\\s*$[\n\r]+/, '' )
      # Remove spaces next to delimiters and replace all with =
      text.gsub!( /^((?:(?:\\[=: \t])|[^=: \t])+)[ \t]*[=: \t][ \t]*/, '\1=' )
      
      text
    end
  
  end
end