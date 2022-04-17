module JavaProperties
  
  module Encoding
  
    # Modules for encoding and decoding special characters for
    # Java properties files.
    
    module SpecialChars
      
      # Encodes all special characters by replacing them with
      # the proper \X escaped value.
      
      def self.encode string
	# Replace special chars with proper \n escaped characters
	string.gsub!( /([\t\n\r\f])/ ) do |c|
	  char = $1
	  case char
	  when "\t"
	    '\\t'
	  when "\n"
	    '\\n'
	  when "\r"
	    '\\r'
	  when "\f"
	    '\\f'
	  end
	end
	string
      end
      
      # Decodes any \X characters read in from a properties file.
      
      def self.decode string
	# Replace \n escaped chars with proper characters
	string.gsub!( /\\(.)/ ) do |c|
	  char = $1 if c =~ /\\(.)/
	  case char
	  when 't'
	    "\t"
	  when 'n'
	    "\n"
	  when 'r'
	    "\r"
	  when 'f'
	    "\f"
	  else
	    char
	  end
	end
	string
      end
    
    end
  
  end
end