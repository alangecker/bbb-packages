module JavaProperties
  
  module Encoding
        
  # Modules for encoding and decoding delimiters characters
  # for Java properties files when those delimiters are
  # found in the property keys.
  
    module Delimiters
      
      # Encodes any delimiter characters found in the
      # property keys by prepending a \
      
      def self.encode string
	s = ''
	prev = ''
	chars = string.split( // )
	while(chars.size > 0) do
	  char = chars.shift
	  if char =~ /[ :=]/ && prev !~ /\\/ then
	    s << "\\" << char
	  else
	    s << char
	  end
	  prev = char
	end
	s
      end
      
      # No decoding is necessary, but this method has
      # been provided for consistency with other
      # encoding modules.
      
      def self.decode string
	string
      end
    end

  end
end