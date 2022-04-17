require 'java_properties/encoding'

# Modules for reading and writing Java properties files.

module JavaProperties
  
  # PropFile allows reading and writing properties files
  #
  #    props = JavaProperties::PropFile.read( file )
  #
  #    JavaProperties::PropFile.write( file, props, "Optional header comment" )
  #
  #    JavaProperties::PropFile.append( file, props, "Optional seperator comment" )
  #
  
  module PropFile
    
    # Reads in a Java properties file and returns the
    # contents as a string for parsing.
    
    def self.read file
      file = open(file)
      text = ''
      while(line = file.gets) do
	text += line
      end
      text
    end
    
    # Writes out a Hash of key/value pairs to a properities
    # file. Optionally a  header comment can be provided.
    
    def self.write file, props, header = nil
      unless header.nil? then
	File.open(file,'w') { |f| f.write "# " + header +"\n" }
        File.open(file,'a') { |f| f.write self.stringify(props) }
    else
        File.open(file,'w') { |f| f.write self.stringify(props) }
      end
    end
    
    # Appends a Hash of key/value paris to the end of an existing
    # properties file. Optionally a seperator comment can be
    # provided.
    
    def self.append file, props, seperator = nil
      unless seperator.nil? then
	File.open(file,'a') { |f| f.write "\n# " + seperator }
      end
      File.open(file,'a') { |f| f.write "\n" + self.stringify(props) }
    end
  
    private
  
    # Converts a Hash of key/value pairs into a String that can
    # be directly saved into a Java properties file.
    
    def self.stringify props
      string = ""
      # Sort to make testing easier -> output will consistent
      props.sort_by do |key,val|
        key.to_s
      end.each do |key,val|
	string << Encoding.encode(key.to_s) << "=" << Encoding.encode(val) << "\n"
      end
      string
    end
    
  end
end